/**
 * Phase 3: embedRepoWorkflow — generates and stores vector embeddings for all entities.
 *
 * Workflow ID: embed-{orgId}-{repoId} (idempotent — stable ID prevents duplicates)
 * Queue: light-llm-queue (Vertex AI Gemini Embedding 001 — managed service)
 *
 * Steps:
 *   1. Set repo status to "embedding"
 *   2. Fetch file paths (lightweight — only string[], not full entities)
 *   3. Process file batches: for each chunk of FILES_PER_BATCH files, call
 *      processAndEmbedBatch which fetches entities, builds docs, embeds,
 *      and stores — all inside the worker, never serializing large payloads
 *      through Temporal's data converter. Batches run in parallel (sliding
 *      window of CONCURRENT_BATCHES) to maximize Bedrock throughput.
 *   4. Delete orphaned embeddings (DB-side comparison — no large arrays in workflow)
 *   5. Set repo status to "ready"
 *   6. Chain to ontology discovery workflow
 *
 * On failure: set repo status to "embed_failed"
 */

import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild } from "@temporalio/workflow"
import { discoverOntologyWorkflow } from "./discover-ontology"
import type * as embeddingActivities from "../activities/embedding"
import type * as pipelineLogs from "../activities/pipeline-logs"
import type * as pipelineRun from "../activities/pipeline-run"

const activities = proxyActivities<typeof embeddingActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "60m",
  heartbeatTimeout: "5m",
  retry: { maximumAttempts: 2 },
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

/**
 * Number of files to process per activity invocation. Vertex AI Gemini Embedding
 * supports large batches (up to 2048 texts/request), so we use bigger file
 * batches to reduce Temporal activity overhead while keeping memory bounded.
 */
const FILES_PER_BATCH = 25

export const getEmbedProgressQuery = defineQuery<number>("getEmbedProgress")

export interface EmbedRepoInput {
  orgId: string
  repoId: string
  lastIndexedSha?: string
  runId?: string
}

/** Workflow-safe log helper (Temporal sandbox — no require/import of Node modules) */
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
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:embed-repo] [${orgId}/${repoId}] ${msg}${extraStr}`)

  logActivities
    .appendPipelineLog({
      timestamp: ts,
      level: level.toLowerCase() as "info" | "warn" | "error",
      phase: "embedding",
      step: step ?? "",
      message: msg,
      meta: { ...extra, repoId: String(repoId), ...(runId && { runId }) },
    })
    .catch(() => {})
}

export async function embedRepoWorkflow(input: EmbedRepoInput): Promise<{
  embeddingsStored: number
  orphansDeleted: number
}> {
  const ctx = { organizationId: input.orgId, repoId: input.repoId, runId: input.runId }
  let progress = 0
  setHandler(getEmbedProgressQuery, () => progress)

  wfLog("INFO", "Embedding workflow started", ctx, "Start")

  try {
    // Step 1: Set status to "embedding"
    wfLog("INFO", "Step 1/6: Setting status to embedding", ctx, "Step 1/6")
    await activities.setEmbeddingStatus({ orgId: input.orgId, repoId: input.repoId })
    progress = 5

    // Step 2: Fetch file paths (lightweight — only string[])
    wfLog("INFO", "Step 2/6: Fetching file paths", ctx, "Step 2/6")
    const allFilePaths = await activities.fetchFilePaths({
      orgId: input.orgId,
      repoId: input.repoId,
    })
    progress = 10
    wfLog("INFO", "Step 2 complete: file paths fetched", { ...ctx, fileCount: allFilePaths.length }, "Step 2/6")

    // Step 3: Process file batches — pagination style: embed, persist, move on.
    // Each batch is fully self-contained: fetch → embed → store → discard.
    // No data accumulates in the workflow between batches.
    const totalBatches = Math.max(1, Math.ceil(allFilePaths.length / FILES_PER_BATCH))
    wfLog("INFO", `Step 3/6: Processing ${totalBatches} file batches (${FILES_PER_BATCH} files each)`, { ...ctx, totalBatches }, "Step 3/6")

    let totalEmbeddingsStored = 0

    // Sliding-window concurrency: process CONCURRENT_BATCHES in parallel.
    // Each processAndEmbedBatch is independent (different files, no shared state),
    // so parallel execution is safe and fully utilizes Vertex AI throughput.
    const CONCURRENT_BATCHES = 10

    for (let windowStart = 0; windowStart < totalBatches; windowStart += CONCURRENT_BATCHES) {
      const windowEnd = Math.min(windowStart + CONCURRENT_BATCHES, totalBatches)
      const promises = []
      for (let i = windowStart; i < windowEnd; i++) {
        const start = i * FILES_PER_BATCH
        const batchPaths = allFilePaths.slice(start, start + FILES_PER_BATCH)
        promises.push(
          activities.processAndEmbedBatch(
            { orgId: input.orgId, repoId: input.repoId },
            batchPaths,
            { index: i, total: totalBatches },
          )
        )
      }
      const results = await Promise.all(promises)
      totalEmbeddingsStored += results.reduce((sum: number, r) => sum + r.embeddingsStored, 0)

      // Progress: 10% (after file paths) → 85% (after all batches)
      progress = 10 + Math.round((windowEnd / totalBatches) * 75)
      wfLog("INFO", `Batches ${windowStart + 1}-${windowEnd}/${totalBatches} complete`, {
        ...ctx,
        windowEmbeddings: results.reduce((sum: number, r) => sum + r.embeddingsStored, 0),
        totalSoFar: totalEmbeddingsStored,
      }, "Step 3/6")
    }

    progress = 85
    wfLog("INFO", "Step 3 complete: all batches embedded", { ...ctx, totalEmbeddingsStored }, "Step 3/6")

    // Step 4: Delete orphaned embeddings (DB-side — no large arrays passed through Temporal)
    wfLog("INFO", "Step 4/6: Deleting orphaned embeddings", ctx, "Step 4/6")
    const { deletedCount } = await activities.deleteOrphanedEmbeddingsFromGraph(
      { orgId: input.orgId, repoId: input.repoId },
    )
    progress = 95
    wfLog("INFO", "Step 4 complete: orphans deleted", { ...ctx, deletedCount }, "Step 4/6")

    // Step 5: Set status to "ready"
    wfLog("INFO", "Step 5/6: Setting status to ready", ctx, "Step 5/6")
    await activities.setReadyStatus({ orgId: input.orgId, repoId: input.repoId, lastIndexedSha: input.lastIndexedSha })
    progress = 98

    // Step 6: Chain to ontology discovery + justification pipeline (Phase 4)
    wfLog("INFO", "Step 6/6: Starting ontology discovery workflow", ctx, "Step 6/6")
    try {
      await startChild(discoverOntologyWorkflow, {
        workflowId: `ontology-${input.orgId}-${input.repoId}`,
        taskQueue: "light-llm-queue",
        args: [{ orgId: input.orgId, repoId: input.repoId, runId: input.runId }],
        parentClosePolicy: ParentClosePolicy.ABANDON,
      })
    } catch (childErr: unknown) {
      const msg = childErr instanceof Error ? childErr.message : String(childErr)
      if (msg.includes("already started") || msg.includes("already exists")) {
        wfLog("WARN", "Ontology workflow already running, skipping duplicate", ctx, "Step 6/6")
      } else {
        throw childErr
      }
    }
    progress = 100

    // TBI-F-01: Mark embed step complete with metrics
    if (input.runId) {
      await runActivities.updatePipelineStep({
        runId: input.runId,
        stepName: "embed",
        status: "completed",
        meta: { embeddingsStored: totalEmbeddingsStored, orphansDeleted: deletedCount },
      })
    }

    // Await final log calls so they complete before the workflow finishes.
    // Fire-and-forget causes "Activity not found on completion" warnings.
    await logActivities.appendPipelineLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "embedding",
      step: "Complete",
      message: "Embedding workflow complete",
      meta: { embeddingsStored: totalEmbeddingsStored, orphansDeleted: deletedCount, repoId: input.repoId, ...(input.runId && { runId: input.runId }) },
    })
    await logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId })
    console.log(`[${new Date().toISOString()}] [INFO ] [wf:embed-repo] [${input.orgId}/${input.repoId}] Embedding workflow complete ${JSON.stringify({ embeddingsStored: totalEmbeddingsStored, orphansDeleted: deletedCount })}`)
    return { embeddingsStored: totalEmbeddingsStored, orphansDeleted: deletedCount }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    wfLog("ERROR", "Embedding workflow failed", { ...ctx, errorMessage: message }, "Error")

    if (input.runId) {
      runActivities.updatePipelineStep({ runId: input.runId, stepName: "embed", status: "failed" }).catch(() => {})
    }

    // Best-effort archive on failure — don't block the error throw
    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId }).catch(() => {})
    await activities.setEmbedFailedStatus(input.repoId, message)
    throw err
  }
}
