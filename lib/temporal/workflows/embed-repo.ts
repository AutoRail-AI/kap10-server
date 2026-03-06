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
 *      window of CONCURRENT_BATCHES) to maximize Vertex AI throughput.
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
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 2 },
})

const runActivities = proxyActivities<typeof pipelineRun>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 2 },
})

/**
 * Number of files to process per activity invocation. Vertex AI Gemini Embedding
 * supports large batches (up to 2048 texts/request via embedMany), so we use
 * bigger file batches to reduce Temporal activity overhead.
 *
 * Tuned together with CONCURRENT_BATCHES:
 *   3 concurrent batches × up to 2000 texts per embedMany call.
 *   Each batch processes 50 files, fetches entities, embeds via embedMany, upserts.
 */
const FILES_PER_BATCH = 50

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

  const workflowStartMs = Date.now()
  wfLog("INFO", "━━━ EMBEDDING WORKFLOW STARTED ━━━", {
    ...ctx,
    filesPerBatch: FILES_PER_BATCH,
  }, "Start")

  try {
    // Step 1: Set status to "embedding"
    wfLog("INFO", "Step 1/6: Setting repo status to 'embedding'", ctx, "Step 1/6")
    await activities.setEmbeddingStatus({ orgId: input.orgId, repoId: input.repoId, runId: input.runId })
    progress = 5

    // Step 2: Fetch file paths (lightweight — only string[])
    const step2Start = Date.now()
    wfLog("INFO", "Step 2/6: Fetching file paths from graph store", ctx, "Step 2/6")
    const allFilePaths = await activities.fetchFilePaths({
      orgId: input.orgId,
      repoId: input.repoId,
      runId: input.runId,
    })
    progress = 10

    const totalBatches = Math.max(1, Math.ceil(allFilePaths.length / FILES_PER_BATCH))
    const CONCURRENT_BATCHES = 3
    const totalWindows = Math.ceil(totalBatches / CONCURRENT_BATCHES)

    wfLog("INFO", `Step 2/6 complete: ${allFilePaths.length} files → ${totalBatches} batches (${FILES_PER_BATCH} files/batch, ${CONCURRENT_BATCHES} concurrent, ${totalWindows} windows)`, {
      ...ctx,
      fileCount: allFilePaths.length,
      totalBatches,
      concurrentBatches: CONCURRENT_BATCHES,
      totalWindows,
      step2Ms: Date.now() - step2Start,
    }, "Step 2/6")

    // Step 3: Process file batches — sliding window of CONCURRENT_BATCHES
    wfLog("INFO", `Step 3/6: Starting batch embedding — ${totalBatches} batches across ${totalWindows} windows`, {
      ...ctx,
      totalBatches,
      totalWindows,
    }, "Step 3/6")

    let totalEmbeddingsStored = 0

    for (let windowStart = 0; windowStart < totalBatches; windowStart += CONCURRENT_BATCHES) {
      const windowEnd = Math.min(windowStart + CONCURRENT_BATCHES, totalBatches)
      const windowNum = Math.floor(windowStart / CONCURRENT_BATCHES) + 1
      const windowStartMs = Date.now()

      wfLog("INFO", `Window ${windowNum}/${totalWindows}: launching batches ${windowStart + 1}-${windowEnd} (${windowEnd - windowStart} parallel activities)`, {
        ...ctx,
        window: windowNum,
        batchRange: `${windowStart + 1}-${windowEnd}`,
        parallelActivities: windowEnd - windowStart,
        totalEmbeddingsSoFar: totalEmbeddingsStored,
      }, "Step 3/6")

      const promises = []
      for (let i = windowStart; i < windowEnd; i++) {
        const start = i * FILES_PER_BATCH
        const batchPaths = allFilePaths.slice(start, start + FILES_PER_BATCH)
        promises.push(
          activities.processAndEmbedBatch(
            { orgId: input.orgId, repoId: input.repoId, runId: input.runId },
            batchPaths,
            { index: i, total: totalBatches },
          )
        )
      }
      const results = await Promise.all(promises)
      const windowEmbeddings = results.reduce((sum: number, r) => sum + r.embeddingsStored, 0)
      totalEmbeddingsStored += windowEmbeddings

      progress = 10 + Math.round((windowEnd / totalBatches) * 75)
      const windowMs = Date.now() - windowStartMs

      wfLog("INFO", `Window ${windowNum}/${totalWindows} complete: ${windowEmbeddings} embeddings stored (${results.map((r) => r.embeddingsStored).join(" + ")}) in ${Math.round(windowMs / 1000)}s | Total so far: ${totalEmbeddingsStored}`, {
        ...ctx,
        window: windowNum,
        windowEmbeddings,
        perBatch: results.map((r) => r.embeddingsStored),
        totalSoFar: totalEmbeddingsStored,
        windowMs,
        progress,
      }, "Step 3/6")
    }

    const step3Ms = Date.now() - step2Start
    progress = 85
    wfLog("INFO", `Step 3/6 complete: all ${totalBatches} batches embedded → ${totalEmbeddingsStored} total embeddings in ${Math.round(step3Ms / 1000)}s`, {
      ...ctx,
      totalEmbeddingsStored,
      totalBatches,
      step3Ms,
      avgEmbeddingsPerBatch: Math.round(totalEmbeddingsStored / totalBatches),
    }, "Step 3/6")

    // Step 4: Delete orphaned embeddings
    const step4Start = Date.now()
    wfLog("INFO", "Step 4/6: Cleaning up orphaned embeddings (entities removed from graph but still in pgvector)", ctx, "Step 4/6")
    const { deletedCount } = await activities.deleteOrphanedEmbeddingsFromGraph(
      { orgId: input.orgId, repoId: input.repoId, runId: input.runId },
    )
    const step4Ms = Date.now() - step4Start
    progress = 95
    wfLog("INFO", `Step 4/6 complete: ${deletedCount} orphaned embeddings deleted in ${Math.round(step4Ms / 1000)}s`, {
      ...ctx,
      deletedCount,
      step4Ms,
    }, "Step 4/6")

    // Step 5: Set status to "ready"
    wfLog("INFO", "Step 5/6: Setting repo status to 'ready'", ctx, "Step 5/6")
    await activities.setReadyStatus({ orgId: input.orgId, repoId: input.repoId, runId: input.runId, lastIndexedSha: input.lastIndexedSha })
    progress = 98

    // Step 6: Chain to ontology discovery
    wfLog("INFO", "Step 6/6: Chaining to ontology discovery workflow", ctx, "Step 6/6")
    try {
      await startChild(discoverOntologyWorkflow, {
        workflowId: `ontology-${input.orgId}-${input.repoId}`,
        taskQueue: "light-llm-queue",
        args: [{ orgId: input.orgId, repoId: input.repoId, runId: input.runId }],
        parentClosePolicy: ParentClosePolicy.ABANDON,
      })
      wfLog("INFO", "Step 6/6: Ontology discovery workflow started", ctx, "Step 6/6")
    } catch (childErr: unknown) {
      const msg = childErr instanceof Error ? childErr.message : String(childErr)
      if (msg.includes("already started") || msg.includes("already exists")) {
        wfLog("WARN", "Ontology workflow already running, skipping duplicate", ctx, "Step 6/6")
      } else {
        throw childErr
      }
    }
    progress = 100

    // Mark embed step complete with metrics
    if (input.runId) {
      await runActivities.updatePipelineStep({
        runId: input.runId,
        stepName: "embed",
        status: "completed",
        meta: { embeddingsStored: totalEmbeddingsStored, orphansDeleted: deletedCount },
      })
    }

    const totalWorkflowMs = Date.now() - workflowStartMs
    const summary = `━━━ EMBEDDING COMPLETE ━━━ ${totalEmbeddingsStored} embeddings stored, ${deletedCount} orphans deleted in ${Math.round(totalWorkflowMs / 1000)}s (${allFilePaths.length} files, ${totalBatches} batches)`

    // Await final log calls so they complete before the workflow finishes.
    await logActivities.appendPipelineLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "embedding",
      step: "Complete",
      message: summary,
      meta: {
        embeddingsStored: totalEmbeddingsStored,
        orphansDeleted: deletedCount,
        fileCount: allFilePaths.length,
        totalBatches,
        totalWorkflowMs,
        repoId: input.repoId,
        ...(input.runId && { runId: input.runId }),
      },
    })
    await logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId })
    console.log(`[${new Date().toISOString()}] [INFO ] [wf:embed-repo] [${input.orgId}/${input.repoId}] ${summary}`)
    return { embeddingsStored: totalEmbeddingsStored, orphansDeleted: deletedCount }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const totalWorkflowMs = Date.now() - workflowStartMs
    wfLog("ERROR", `━━━ EMBEDDING FAILED ━━━ after ${Math.round(totalWorkflowMs / 1000)}s: ${message}`, {
      ...ctx,
      errorMessage: message,
      totalWorkflowMs,
    }, "Error")

    if (input.runId) {
      runActivities.updatePipelineStep({ runId: input.runId, stepName: "embed", status: "failed" }).catch(() => {})
    }

    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId }).catch(() => {})
    await activities.setEmbedFailedStatus(input.repoId, message)
    throw err
  }
}
