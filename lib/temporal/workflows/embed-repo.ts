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
import { discoverOntologyWorkflow } from "./discover-ontology"

const activities = proxyActivities<typeof embeddingActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "30m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

export const getEmbedProgressQuery = defineQuery<number>("getEmbedProgress")

export interface EmbedRepoInput {
  orgId: string
  repoId: string
  lastIndexedSha?: string
}

export async function embedRepoWorkflow(input: EmbedRepoInput): Promise<{
  embeddingsStored: number
  orphansDeleted: number
}> {
  let progress = 0
  setHandler(getEmbedProgressQuery, () => progress)

  try {
    // Step 1: Set status to "embedding"
    await activities.setEmbeddingStatus({ orgId: input.orgId, repoId: input.repoId })
    progress = 5

    // Step 2: Fetch all entities from ArangoDB
    const entities = await activities.fetchEntities({
      orgId: input.orgId,
      repoId: input.repoId,
    })
    progress = 15

    // Step 3: Build embeddable documents
    const documents = await activities.buildDocuments(
      { orgId: input.orgId, repoId: input.repoId },
      entities
    )
    progress = 25

    // Step 4: Generate embeddings + store in pgvector
    const { embeddingsStored } = await activities.generateAndStoreEmbeds(
      { orgId: input.orgId, repoId: input.repoId },
      documents
    )
    progress = 85

    // Step 5: Delete orphaned embeddings
    const currentEntityKeys = documents.map((d) => d.entityKey)
    const { deletedCount } = await activities.deleteOrphanedEmbeddings(
      { orgId: input.orgId, repoId: input.repoId },
      currentEntityKeys
    )
    progress = 95

    // Step 6: Set status to "ready"
    await activities.setReadyStatus({ orgId: input.orgId, repoId: input.repoId, lastIndexedSha: input.lastIndexedSha })
    progress = 98

    // Step 7: Chain to ontology discovery + justification pipeline (Phase 4)
    await startChild(discoverOntologyWorkflow, {
      workflowId: `ontology-${input.orgId}-${input.repoId}-${workflowInfo().runId.slice(0, 8)}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })
    progress = 100

    return { embeddingsStored, orphansDeleted: deletedCount }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await activities.setEmbedFailedStatus(input.repoId, message)
    throw err
  }
}
