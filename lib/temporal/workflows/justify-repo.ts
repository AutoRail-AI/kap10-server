/**
 * Phase 4: justifyRepoWorkflow — orchestrates the full justification pipeline.
 *
 * Workflow ID: justify-{orgId}-{repoId}
 * Queue: light-llm-queue
 *
 * Steps:
 *   1. Set repo status to "justifying"
 *   2. Fetch entity/edge counts (data stays in ArangoDB)
 *   3. Load domain ontology
 *   4. Topological sort → returns entity ID arrays per level
 *   5. For each level: justifyBatch(input, entityIds) — fetches data, justifies, stores
 *   6. Post-process: feature aggregations
 *   7. Embed justifications in pgvector
 *   8. Chain to health report generation
 *   9. Set repo status to "ready"
 *
 * Activities are self-sufficient — they fetch data from ArangoDB directly.
 * Only small references (IDs, counts) cross the Temporal serialization boundary,
 * keeping all payloads well under the 4MB gRPC limit.
 */

import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow"
import type * as justificationActivities from "../activities/justification"
import type * as pipelineLogs from "../activities/pipeline-logs"
import { generateHealthReportWorkflow } from "./generate-health-report"

const activities = proxyActivities<typeof justificationActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "60m",
  heartbeatTimeout: "5m",
  retry: { maximumAttempts: 3 },
})

const logActivities = proxyActivities<typeof pipelineLogs>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 1 },
})

export const getJustifyProgressQuery = defineQuery<number>("getJustifyProgress")

export interface JustifyRepoInput {
  orgId: string
  repoId: string
}

/** Workflow-safe log helper */
function wfLog(level: string, msg: string, ctx: Record<string, unknown>, step?: string) {
  const ts = new Date().toISOString()
  const orgId = ctx.organizationId ?? "-"
  const repoId = ctx.repoId ?? "-"
  const extra = { ...ctx }
  delete extra.organizationId
  delete extra.repoId
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : ""
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:justify-repo] [${orgId}/${repoId}] ${msg}${extraStr}`)

  logActivities
    .appendPipelineLog({
      timestamp: ts,
      level: level.toLowerCase() as "info" | "warn" | "error",
      phase: "justifying",
      step: step ?? "",
      message: msg,
      meta: { ...extra, repoId: String(repoId) },
    })
    .catch(() => {})
}

export async function justifyRepoWorkflow(input: JustifyRepoInput): Promise<{
  entitiesJustified: number
  embeddingsStored: number
}> {
  const ctx = { organizationId: input.orgId, repoId: input.repoId }
  let progress = 0
  setHandler(getJustifyProgressQuery, () => progress)

  wfLog("INFO", "Justification workflow started", ctx, "Start")

  try {
    // Step 1: Set status
    wfLog("INFO", "Step 1/10: Setting status to justifying", ctx, "Step 1/10")
    await activities.setJustifyingStatus(input)
    progress = 5

    // Step 2: Fetch entity/edge counts (data stays in ArangoDB)
    wfLog("INFO", "Step 2/10: Fetching entity and edge counts", ctx, "Step 2/10")
    const { entityCount, edgeCount } = await activities.fetchEntitiesAndEdges(input)
    progress = 15
    wfLog("INFO", "Step 2 complete", { ...ctx, entityCount, edgeCount }, "Step 2/10")

    if (entityCount === 0) {
      wfLog("INFO", "No entities to justify, marking done", ctx, "Complete")
      await activities.setJustifyDoneStatus(input)
      return { entitiesJustified: 0, embeddingsStored: 0 }
    }

    // Step 3: Load ontology (small payload, kept as return value)
    wfLog("INFO", "Step 3/10: Loading ontology", ctx, "Step 3/10")
    await activities.loadOntology(input)
    progress = 20

    // Step 4: Topological sort → returns entity ID arrays per level (~50KB)
    wfLog("INFO", "Step 4/10: Topological sort", ctx, "Step 4/10")
    const levels = await activities.performTopologicalSort(input)
    progress = 25
    wfLog("INFO", "Step 4 complete", { ...ctx, levelCount: levels.length }, "Step 4/10")

    // Step 5: Process each level bottom-up with cascading staleness tracking
    // Large levels (100+ entities) are split into parallel chunks for 2-3x speedup
    wfLog("INFO", "Step 5/10: Justifying entities level-by-level", { ...ctx, levelCount: levels.length }, "Step 5/10")
    let totalJustified = 0
    const levelProgressStep = 50 / Math.max(levels.length, 1)
    // Use a bounded set to track changed IDs — avoids unbounded array growth
    // through Temporal's workflow state. Only the most recent batch of changed
    // IDs is passed to the next level (callee changes propagate one level up).
    let previousLevelChangedIds: string[] = []
    const PARALLEL_CHUNK_SIZE = 100

    for (let i = 0; i < levels.length; i++) {
      const levelEntityIds = levels[i]!
      wfLog("INFO", `Processing level ${i + 1}/${levels.length}`, { ...ctx, levelEntityCount: levelEntityIds.length }, `Step 5/10 (L${i + 1})`)

      const levelChangedIds: string[] = []

      if (levelEntityIds.length <= PARALLEL_CHUNK_SIZE) {
        const { justifiedCount, changedEntityIds } = await activities.justifyBatch(input, levelEntityIds, previousLevelChangedIds)
        totalJustified += justifiedCount
        levelChangedIds.push(...changedEntityIds)
      } else {
        const chunks: string[][] = []
        for (let j = 0; j < levelEntityIds.length; j += PARALLEL_CHUNK_SIZE) {
          chunks.push(levelEntityIds.slice(j, j + PARALLEL_CHUNK_SIZE))
        }
        wfLog("INFO", `Splitting level ${i + 1} into ${chunks.length} parallel chunks`, { ...ctx, chunkCount: chunks.length }, `Step 5/10 (L${i + 1})`)

        const chunkResults = await Promise.all(
          chunks.map((chunk) => activities.justifyBatch(input, chunk, previousLevelChangedIds))
        )
        for (const { justifiedCount, changedEntityIds } of chunkResults) {
          totalJustified += justifiedCount
          levelChangedIds.push(...changedEntityIds)
        }
      }

      // Only carry forward this level's changes (not cumulative across all levels)
      previousLevelChangedIds = levelChangedIds
      progress = Math.round(25 + (i + 1) * levelProgressStep)

      // Every 20 levels, refine ontology with newly discovered domain concepts
      if ((i + 1) % 20 === 0 && i + 1 < levels.length) {
        wfLog("INFO", `Refining ontology with new concepts (after level ${i + 1})`, ctx, `Step 5/10 (L${i + 1})`)
        const { newTermsAdded } = await activities.refineOntologyWithNewConcepts(input)
        if (newTermsAdded > 0) {
          wfLog("INFO", `Added ${newTermsAdded} new terms to ontology`, ctx, `Step 5/10 (L${i + 1})`)
        }
      }
    }

    // Step 6: Bi-directional context propagation
    wfLog("INFO", "Step 6/10: Propagating context across entity hierarchy", ctx, "Step 6/10")
    await activities.propagateContextActivity(input)
    progress = 78

    // Step 7: Store feature aggregations (fetches justifications from ArangoDB)
    wfLog("INFO", "Step 7/10: Storing feature aggregations", ctx, "Step 7/10")
    await activities.storeFeatureAggregations(input)
    progress = 82

    // Step 8: Embed justifications (fetches justifications from ArangoDB)
    wfLog("INFO", "Step 8/10: Embedding justifications", ctx, "Step 8/10")
    const embeddingsStored = await activities.embedJustifications(input)
    progress = 90

    // Step 9: Chain to health report
    wfLog("INFO", "Step 9/10: Starting health report workflow", ctx, "Step 9/10")
    await startChild(generateHealthReportWorkflow, {
      workflowId: `health-${input.orgId}-${input.repoId}-${workflowInfo().runId.slice(0, 8)}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })

    // Step 10: Set ready
    wfLog("INFO", "Step 10/10: Setting status to ready", ctx, "Step 10/10")
    await activities.setJustifyDoneStatus(input)
    progress = 100

    await logActivities.appendPipelineLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "justifying",
      step: "Complete",
      message: "Justification workflow complete",
      meta: { entitiesJustified: totalJustified, embeddingsStored, repoId: input.repoId },
    })
    await logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId })
    console.log(`[${new Date().toISOString()}] [INFO ] [wf:justify-repo] [${input.orgId}/${input.repoId}] Justification workflow complete ${JSON.stringify({ entitiesJustified: totalJustified, embeddingsStored })}`)
    return {
      entitiesJustified: totalJustified,
      embeddingsStored,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    wfLog("ERROR", "Justification workflow failed", { ...ctx, errorMessage: message }, "Error")
    // Best-effort archive on failure — don't block the error throw
    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId }).catch(() => {})
    await activities.setJustifyFailedStatus(input.repoId, message)
    throw err
  }
}
