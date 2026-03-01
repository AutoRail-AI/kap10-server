/**
 * Phase 4: justifyRepoWorkflow — orchestrates the full justification pipeline.
 *
 * Workflow ID: justify-{orgId}-{repoId} (idempotent — stable ID prevents duplicates)
 * Queue: light-llm-queue
 *
 * Data Residency Pattern:
 *   Heavy data (entity ID arrays, changed IDs) lives in Redis, never crosses
 *   Temporal's 4MB gRPC boundary. The workflow only passes counts and references.
 *   - Topological levels: stored in Redis by performTopologicalSort, read via fetchTopologicalLevel
 *   - Changed entity IDs: stored per-level in Redis by storeChangedEntityIds, read via fetchPreviousLevelChangedIds
 *   - Cleanup: cleanupJustificationCache removes all temp Redis keys after completion
 *
 * Steps:
 *   1. Set repo status to "justifying"
 *   2. Fetch entity/edge counts (data stays in ArangoDB)
 *   3. Load domain ontology
 *   4. Topological sort → stores levels in Redis, returns { levelCount }
 *   5. For each level: fetch IDs from Redis, justifyBatch, store changed IDs in Redis
 *   6. Post-process: feature aggregations
 *   7. Embed justifications in pgvector
 *   8. Chain to health report generation
 *   9. Set repo status to "ready"
 *
 * On failure: set repo status to "justify_failed"
 */

import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild } from "@temporalio/workflow"
import { generateHealthReportWorkflow } from "./generate-health-report"
import type * as embeddingActivities from "../activities/embedding"
import type * as justificationActivities from "../activities/justification"
import type * as pipelineLogs from "../activities/pipeline-logs"
import type * as pipelineRun from "../activities/pipeline-run"

const activities = proxyActivities<typeof justificationActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "60m",
  heartbeatTimeout: "5m",
  retry: { maximumAttempts: 3 },
})

const embedActivities = proxyActivities<typeof embeddingActivities>({
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

const runActivities = proxyActivities<typeof pipelineRun>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 2 },
})

export const getJustifyProgressQuery = defineQuery<number>("getJustifyProgress")

export interface JustifyRepoInput {
  orgId: string
  repoId: string
  runId?: string
}

/** Workflow-safe log helper */
function wfLog(level: string, msg: string, ctx: Record<string, unknown>, step?: string) {
  const ts = new Date().toISOString()
  const orgId = ctx.organizationId ?? "-"
  const repoId = ctx.repoId ?? "-"
  const runId = ctx.runId as string | undefined
  const extra = { ...ctx }
  delete extra.organizationId
  delete extra.repoId
  delete extra.runId
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : ""
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:justify-repo] [${orgId}/${repoId}] ${msg}${extraStr}`)

  logActivities
    .appendPipelineLog({
      timestamp: ts,
      level: level.toLowerCase() as "info" | "warn" | "error",
      phase: "justifying",
      step: step ?? "",
      message: msg,
      meta: { ...extra, repoId: String(repoId), ...(runId && { runId }) },
    })
    .catch(() => {})
}

export async function justifyRepoWorkflow(input: JustifyRepoInput): Promise<{
  entitiesJustified: number
  embeddingsStored: number
}> {
  const ctx = { organizationId: input.orgId, repoId: input.repoId, runId: input.runId }
  let progress = 0
  setHandler(getJustifyProgressQuery, () => progress)

  wfLog("INFO", "Justification workflow started", ctx, "Start")

  try {
    // TBI-F-01: Mark justification step as running
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "justification", status: "running" })

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

    // Step 4: Topological sort → data residency pattern: levels stored in Redis,
    // only the count crosses Temporal's gRPC boundary (avoids 5MB+ payload for large repos)
    wfLog("INFO", "Step 4/10: Topological sort (data stored in Redis)", ctx, "Step 4/10")
    const { levelCount } = await activities.performTopologicalSort(input)
    progress = 23
    wfLog("INFO", "Step 4 complete", { ...ctx, levelCount }, "Step 4/10")

    // Step 4b: L-21 — Community detection via Louvain
    // Writes community_id + community_label onto entities before justification
    wfLog("INFO", "Step 4b/10: Detecting communities via Louvain", ctx, "Step 4b/10")
    const { communityCount } = await activities.detectCommunitiesActivity(input)
    progress = 27
    wfLog("INFO", "Step 4b complete", { ...ctx, communityCount }, "Step 4b/10")

    // Step 5: Process each level bottom-up with cascading staleness tracking.
    // Entity IDs are fetched from Redis one level at a time — never held in workflow state.
    // Changed entity IDs are also stored in Redis, not returned through Temporal.
    const maxParallel = await activities.getJustificationConcurrency()
    wfLog("INFO", "Step 5/10: Justifying entities level-by-level", { ...ctx, levelCount, maxParallel }, "Step 5/10")
    let totalJustified = 0
    const levelProgressStep = 50 / Math.max(levelCount, 1)
    const PARALLEL_CHUNK_SIZE = 100

    // C-02: Accumulate changed entity IDs across ALL prior levels (not just N-1).
    // This ensures entities at level N can detect staleness caused by changes at any
    // earlier level, not just the immediately preceding one.
    let accumulatedChangedIds: string[] = []

    for (let i = 0; i < levelCount; i++) {
      // Fetch this level's entity IDs from Redis (data residency)
      const levelEntityIds = await activities.fetchTopologicalLevel(input, i)
      // C-02: Use accumulated changed IDs from ALL prior levels
      const previousLevelChangedIds = accumulatedChangedIds

      wfLog("INFO", `Processing level ${i + 1}/${levelCount}`, { ...ctx, levelEntityCount: levelEntityIds.length }, `Step 5/10 (L${i + 1})`)

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
        wfLog("INFO", `Splitting level ${i + 1} into ${chunks.length} chunks (max ${maxParallel} parallel)`, { ...ctx, chunkCount: chunks.length, maxParallel }, `Step 5/10 (L${i + 1})`)

        // Process chunks with provider-aware concurrency control
        // (e.g., Ollama=1 sequential, OpenAI=2-5, Google/Anthropic=5-10)
        for (let c = 0; c < chunks.length; c += maxParallel) {
          const batch = chunks.slice(c, c + maxParallel)
          const chunkResults = await Promise.all(
            batch.map((chunk) => activities.justifyBatch(input, chunk, previousLevelChangedIds))
          )
          for (const { justifiedCount, changedEntityIds } of chunkResults) {
            totalJustified += justifiedCount
            levelChangedIds.push(...changedEntityIds)
          }
        }
      }

      // Store this level's changed IDs in Redis (kept for external queries)
      await activities.storeChangedEntityIds(input, i, levelChangedIds)

      // C-02: Accumulate this level's changed IDs for all future levels.
      // Cap at 5000 to prevent unbounded growth in workflow state for massive repos.
      if (levelChangedIds.length > 0) {
        accumulatedChangedIds = [...accumulatedChangedIds, ...levelChangedIds]
        if (accumulatedChangedIds.length > 5000) {
          accumulatedChangedIds = accumulatedChangedIds.slice(-5000)
        }
      }

      progress = Math.round(25 + (i + 1) * levelProgressStep)

      // Every 20 levels, refine ontology with newly discovered domain concepts
      if ((i + 1) % 20 === 0 && i + 1 < levelCount) {
        wfLog("INFO", `Refining ontology with new concepts (after level ${i + 1})`, ctx, `Step 5/10 (L${i + 1})`)
        const { newTermsAdded } = await activities.refineOntologyWithNewConcepts(input)
        if (newTermsAdded > 0) {
          wfLog("INFO", `Added ${newTermsAdded} new terms to ontology`, ctx, `Step 5/10 (L${i + 1})`)
        }
      }
    }

    // Cleanup Redis cache for topological data
    await activities.cleanupJustificationCache(input, levelCount)

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

    // Step 8b: L-07 Pass 2 — Re-embed entities with justification context
    wfLog("INFO", "Step 8b/10: Re-embedding entities with justification context (Pass 2)", ctx, "Step 8b/10")
    const { embeddingsStored: pass2Stored } = await embedActivities.reEmbedWithJustifications({
      orgId: input.orgId, repoId: input.repoId,
    })
    progress = 92
    wfLog("INFO", "Step 8b complete", { ...ctx, pass2Stored }, "Step 8b/10")

    // Step 9: Chain to health report (stable ID prevents duplicates on retry)
    wfLog("INFO", "Step 9/10: Starting health report workflow", ctx, "Step 9/10")
    try {
      await startChild(generateHealthReportWorkflow, {
        workflowId: `health-${input.orgId}-${input.repoId}`,
        taskQueue: "light-llm-queue",
        args: [{ orgId: input.orgId, repoId: input.repoId, runId: input.runId }],
        parentClosePolicy: ParentClosePolicy.ABANDON,
      })
    } catch (childErr: unknown) {
      const msg = childErr instanceof Error ? childErr.message : String(childErr)
      if (msg.includes("already started") || msg.includes("already exists")) {
        wfLog("WARN", "Health report workflow already running, skipping duplicate", ctx, "Step 9/10")
      } else {
        throw childErr
      }
    }

    // Step 10: Set ready
    wfLog("INFO", "Step 10/10: Setting status to ready", ctx, "Step 10/10")
    await activities.setJustifyDoneStatus(input)
    progress = 100

    // TBI-F-01: Mark justification step complete with metrics
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "justification", status: "completed", meta: { entitiesJustified: totalJustified, embeddingsStored } })

    await logActivities.appendPipelineLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "justifying",
      step: "Complete",
      message: "Justification workflow complete",
      meta: { entitiesJustified: totalJustified, embeddingsStored, repoId: input.repoId, ...(input.runId && { runId: input.runId }) },
    })
    await logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId })
    console.log(`[${new Date().toISOString()}] [INFO ] [wf:justify-repo] [${input.orgId}/${input.repoId}] Justification workflow complete ${JSON.stringify({ entitiesJustified: totalJustified, embeddingsStored })}`)
    return {
      entitiesJustified: totalJustified,
      embeddingsStored,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    wfLog("ERROR", "Justification workflow failed", { ...ctx, errorMessage: message }, "Error")
    // Best-effort archive on failure — don't block the error throw
    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId }).catch(() => {})
    await activities.setJustifyFailedStatus(input.repoId, message)
    throw err
  }
}
