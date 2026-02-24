/**
 * Phase 3: embedRepoWorkflow — generates and stores vector embeddings for all entities.
 *
 * Workflow ID: embed-{orgId}-{repoId} (idempotent — re-triggering terminates old workflow)
 * Queue: light-llm-queue (CPU-bound ONNX inference)
 *
 * Steps:
 *   1. Set repo status to "embedding"
 *   2. Fetch file paths (lightweight — only string[], not full entities)
 *   3. Process file batches: for each chunk of FILES_PER_BATCH files, call
 *      processAndEmbedBatch which fetches entities, builds docs, embeds,
 *      and stores — all inside the worker, never serializing large payloads
 *      through Temporal's data converter.
 *   4. Delete orphaned embeddings (entities removed since last embed)
 *   5. Set repo status to "ready"
 *   6. Chain to ontology discovery workflow
 *
 * On failure: set repo status to "embed_failed"
 */

import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow"
import type * as embeddingActivities from "../activities/embedding"
import type * as pipelineLogs from "../activities/pipeline-logs"
import { discoverOntologyWorkflow } from "./discover-ontology"

const activities = proxyActivities<typeof embeddingActivities>({
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

/**
 * Number of files to process per activity invocation. Kept small so each
 * activity completes quickly (good for heartbeats) and limits peak memory.
 * ONNX model (~500MB base) + inference (~200MB per doc at 512 tokens).
 * 5 files ≈ 8-10 entities — finishes in ~30s, well under heartbeat timeout.
 */
const FILES_PER_BATCH = 5

export const getEmbedProgressQuery = defineQuery<number>("getEmbedProgress")

export interface EmbedRepoInput {
  orgId: string
  repoId: string
  lastIndexedSha?: string
}

/** Workflow-safe log helper (Temporal sandbox — no require/import of Node modules) */
function wfLog(level: string, msg: string, ctx: Record<string, unknown>, step?: string) {
  const ts = new Date().toISOString()
  const orgId = ctx.organizationId ?? "-"
  const repoId = ctx.repoId ?? "-"
  const extra = { ...ctx }
  delete extra.organizationId
  delete extra.repoId
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : ""
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:embed-repo] [${orgId}/${repoId}] ${msg}${extraStr}`)

  logActivities
    .appendPipelineLog({
      timestamp: ts,
      level: level.toLowerCase() as "info" | "warn" | "error",
      phase: "embedding",
      step: step ?? "",
      message: msg,
      meta: { ...extra, repoId: String(repoId) },
    })
    .catch(() => {})
}

export async function embedRepoWorkflow(input: EmbedRepoInput): Promise<{
  embeddingsStored: number
  orphansDeleted: number
}> {
  const ctx = { organizationId: input.orgId, repoId: input.repoId }
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

    // Step 3: Process file batches — chunk paths and fan out
    const totalBatches = Math.max(1, Math.ceil(allFilePaths.length / FILES_PER_BATCH))
    wfLog("INFO", `Step 3/6: Processing ${totalBatches} file batches (${FILES_PER_BATCH} files each)`, { ...ctx, totalBatches }, "Step 3/6")

    let totalEmbeddingsStored = 0
    const allEntityKeys: string[] = []

    for (let i = 0; i < totalBatches; i++) {
      const start = i * FILES_PER_BATCH
      const batchPaths = allFilePaths.slice(start, start + FILES_PER_BATCH)

      const result = await activities.processAndEmbedBatch(
        { orgId: input.orgId, repoId: input.repoId },
        batchPaths,
        { index: i, total: totalBatches },
      )

      totalEmbeddingsStored += result.embeddingsStored
      allEntityKeys.push(...result.entityKeys)

      // Progress: 10% (after file paths) → 85% (after all batches)
      progress = 10 + Math.round(((i + 1) / totalBatches) * 75)
      wfLog("INFO", `Batch ${i + 1}/${totalBatches} complete`, {
        ...ctx,
        batchEmbeddings: result.embeddingsStored,
        totalSoFar: totalEmbeddingsStored,
      }, "Step 3/6")
    }

    progress = 85
    wfLog("INFO", "Step 3 complete: all batches embedded", { ...ctx, totalEmbeddingsStored }, "Step 3/6")

    // Step 4: Delete orphaned embeddings
    wfLog("INFO", "Step 4/6: Deleting orphaned embeddings", ctx, "Step 4/6")
    const { deletedCount } = await activities.deleteOrphanedEmbeddings(
      { orgId: input.orgId, repoId: input.repoId },
      allEntityKeys,
    )
    progress = 95
    wfLog("INFO", "Step 4 complete: orphans deleted", { ...ctx, deletedCount }, "Step 4/6")

    // Step 5: Set status to "ready"
    wfLog("INFO", "Step 5/6: Setting status to ready", ctx, "Step 5/6")
    await activities.setReadyStatus({ orgId: input.orgId, repoId: input.repoId, lastIndexedSha: input.lastIndexedSha })
    progress = 98

    // Step 6: Chain to ontology discovery + justification pipeline (Phase 4)
    wfLog("INFO", "Step 6/6: Starting ontology discovery workflow", ctx, "Step 6/6")
    await startChild(discoverOntologyWorkflow, {
      workflowId: `ontology-${input.orgId}-${input.repoId}-${workflowInfo().runId.slice(0, 8)}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })
    progress = 100

    // Await final log calls so they complete before the workflow finishes.
    // Fire-and-forget causes "Activity not found on completion" warnings.
    await logActivities.appendPipelineLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "embedding",
      step: "Complete",
      message: "Embedding workflow complete",
      meta: { embeddingsStored: totalEmbeddingsStored, orphansDeleted: deletedCount, repoId: input.repoId },
    })
    await logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId })
    console.log(`[${new Date().toISOString()}] [INFO ] [wf:embed-repo] [${input.orgId}/${input.repoId}] Embedding workflow complete ${JSON.stringify({ embeddingsStored: totalEmbeddingsStored, orphansDeleted: deletedCount })}`)
    return { embeddingsStored: totalEmbeddingsStored, orphansDeleted: deletedCount }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    wfLog("ERROR", "Embedding workflow failed", { ...ctx, errorMessage: message }, "Error")
    // Best-effort archive on failure — don't block the error throw
    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId }).catch(() => {})
    await activities.setEmbedFailedStatus(input.repoId, message)
    throw err
  }
}
