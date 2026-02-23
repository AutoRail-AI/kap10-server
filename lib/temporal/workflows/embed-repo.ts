/**
 * Phase 3: embedRepoWorkflow — generates and stores vector embeddings for all entities.
 *
 * Workflow ID: embed-{orgId}-{repoId} (idempotent — re-triggering terminates old workflow)
 * Queue: light-llm-queue (CPU-bound ONNX inference)
 *
 * Steps:
 *   1. Set repo status to "embedding"
 *   2. Fetch all entities from ArangoDB
 *   3. Build embeddable documents (text + metadata)
 *   4. Generate embeddings + store in pgvector (batched, with heartbeat)
 *   5. Delete orphaned embeddings (entities removed since last embed)
 *   6. Set repo status to "ready"
 *
 * On failure: set repo status to "embed_failed"
 */

import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow"
import type * as embeddingActivities from "../activities/embedding"
import type * as pipelineLogs from "../activities/pipeline-logs"
import { discoverOntologyWorkflow } from "./discover-ontology"

const activities = proxyActivities<typeof embeddingActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "30m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

const logActivities = proxyActivities<typeof pipelineLogs>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 1 },
})

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
    wfLog("INFO", "Step 1/7: Setting status to embedding", ctx, "Step 1/7")
    await activities.setEmbeddingStatus({ orgId: input.orgId, repoId: input.repoId })
    progress = 5

    // Step 2: Fetch all entities from ArangoDB
    wfLog("INFO", "Step 2/7: Fetching entities", ctx, "Step 2/7")
    const entities = await activities.fetchEntities({
      orgId: input.orgId,
      repoId: input.repoId,
    })
    progress = 15
    wfLog("INFO", "Step 2 complete: entities fetched", { ...ctx, entityCount: entities.length }, "Step 2/7")

    // Step 3: Build embeddable documents
    wfLog("INFO", "Step 3/7: Building embeddable documents", ctx, "Step 3/7")
    const documents = await activities.buildDocuments(
      { orgId: input.orgId, repoId: input.repoId },
      entities
    )
    progress = 25
    wfLog("INFO", "Step 3 complete: documents built", { ...ctx, documentCount: documents.length }, "Step 3/7")

    // Step 4: Generate embeddings + store in pgvector
    wfLog("INFO", "Step 4/7: Generating and storing embeddings", ctx, "Step 4/7")
    const { embeddingsStored } = await activities.generateAndStoreEmbeds(
      { orgId: input.orgId, repoId: input.repoId },
      documents
    )
    progress = 85
    wfLog("INFO", "Step 4 complete: embeddings stored", { ...ctx, embeddingsStored }, "Step 4/7")

    // Step 5: Delete orphaned embeddings
    wfLog("INFO", "Step 5/7: Deleting orphaned embeddings", ctx, "Step 5/7")
    const currentEntityKeys = documents.map((d) => d.entityKey)
    const { deletedCount } = await activities.deleteOrphanedEmbeddings(
      { orgId: input.orgId, repoId: input.repoId },
      currentEntityKeys
    )
    progress = 95
    wfLog("INFO", "Step 5 complete: orphans deleted", { ...ctx, deletedCount }, "Step 5/7")

    // Step 6: Set status to "ready"
    wfLog("INFO", "Step 6/7: Setting status to ready", ctx, "Step 6/7")
    await activities.setReadyStatus({ orgId: input.orgId, repoId: input.repoId, lastIndexedSha: input.lastIndexedSha })
    progress = 98

    // Step 7: Chain to ontology discovery + justification pipeline (Phase 4)
    wfLog("INFO", "Step 7/7: Starting ontology discovery workflow", ctx, "Step 7/7")
    await startChild(discoverOntologyWorkflow, {
      workflowId: `ontology-${input.orgId}-${input.repoId}-${workflowInfo().runId.slice(0, 8)}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })
    progress = 100

    wfLog("INFO", "Embedding workflow complete", { ...ctx, embeddingsStored, orphansDeleted: deletedCount }, "Complete")
    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId }).catch(() => {})
    return { embeddingsStored, orphansDeleted: deletedCount }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    wfLog("ERROR", "Embedding workflow failed", { ...ctx, errorMessage: message }, "Error")
    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId }).catch(() => {})
    await activities.setEmbedFailedStatus(input.repoId, message)
    throw err
  }
}
