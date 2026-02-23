/**
 * Phase 3: Embedding activities for the embedRepoWorkflow.
 * Runs on light-llm-queue (CPU-bound ONNX inference, no GPU needed).
 *
 * Activities:
 *   - setEmbeddingStatus: Set repo status to "embedding"
 *   - fetchEntities: Read all entities from ArangoDB
 *   - buildDocuments: Transform entities into embeddable text + metadata
 *   - generateAndStoreEmbeds: Batch embed + upsert into pgvector
 *   - deleteOrphanedEmbeddings: Remove stale embeddings for deleted entities
 *   - setReadyStatus: Set repo status to "ready"
 *   - setEmbedFailedStatus: Set repo status to "embed_failed"
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import type { EntityDoc } from "@/lib/ports/types"
import { createPipelineLogger } from "@/lib/temporal/activities/pipeline-logs"
import { logger } from "@/lib/utils/logger"

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface EmbeddingInput {
  orgId: string
  repoId: string
}

export interface EmbeddableDocument {
  entityKey: string
  text: string
  metadata: {
    orgId: string
    repoId: string
    entityKey: string
    entityType: string
    entityName: string
    filePath: string
    textContent: string
  }
}

// ── Status Activities ─────────────────────────────────────────────────────────

export async function setEmbeddingStatus(input: EmbeddingInput): Promise<void> {
  const log = logger.child({ service: "embedding", organizationId: input.orgId, repoId: input.repoId })
  log.info("Setting repo status to embedding")
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "embedding",
    progress: 0,
  })
}

export async function setReadyStatus(input: EmbeddingInput & { lastIndexedSha?: string }): Promise<void> {
  const log = logger.child({ service: "embedding", organizationId: input.orgId, repoId: input.repoId })
  log.info("Setting repo status to ready")
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "ready",
    progress: 100,
    errorMessage: null,
    lastIndexedSha: input.lastIndexedSha ?? null,
  })
}

export async function setEmbedFailedStatus(
  repoId: string,
  errorMessage: string
): Promise<void> {
  logger.error("Embedding failed", undefined, { service: "embedding", repoId, errorMessage })
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(repoId, {
    status: "embed_failed",
    errorMessage,
  })
}

// ── fetchEntities ─────────────────────────────────────────────────────────────

export async function fetchEntities(input: EmbeddingInput): Promise<EntityDoc[]> {
  const log = logger.child({ service: "embedding", organizationId: input.orgId, repoId: input.repoId })
  const plog = createPipelineLogger(input.repoId, "embedding")
  const container = getContainer()
  plog.log("info", "Step 2/7", "Fetching entities from graph store...")

  // Get all file paths for the repo, then get all entities per file
  const filePaths = await container.graphStore.getFilePaths(input.orgId, input.repoId)
  const allEntities: EntityDoc[] = []

  for (const { path } of filePaths) {
    const entities = await container.graphStore.getEntitiesByFile(
      input.orgId,
      input.repoId,
      path
    )
    allEntities.push(...entities)
  }

  log.info("Fetched entities for embedding", { fileCount: filePaths.length, entityCount: allEntities.length })
  plog.log("info", "Step 2/7", `Fetched ${allEntities.length} entities from ${filePaths.length} files`)
  heartbeat(`Fetched ${allEntities.length} entities`)
  return allEntities
}

// ── buildDocuments ────────────────────────────────────────────────────────────

/** Max tokens for entity body before truncation. */
const MAX_BODY_CHARS = 24000 // ~6000 tokens at 4 chars/token

/**
 * Transform entities into embeddable documents with formatted text + metadata.
 * Text format: "{Kind}: {name}\nFile: {filePath}\nSignature: {signature}\n\n{body}"
 */
export async function buildDocuments(
  input: EmbeddingInput,
  entities: EntityDoc[]
): Promise<EmbeddableDocument[]> {
  const docs: EmbeddableDocument[] = []

  for (const entity of entities) {
    // Skip file entities (they don't carry meaningful semantic content)
    if (entity.kind === "file" || entity.kind === "directory" || entity.kind === "module" || entity.kind === "namespace") {
      continue
    }

    const kindLabel = formatKindLabel(entity.kind)
    const name = entity.name ?? "unknown"
    const filePath = entity.file_path ?? ""
    const signature = (entity.signature as string) ?? ""
    const body = (entity.body as string) ?? ""

    // Build text for embedding
    const parts: string[] = []
    parts.push(`${kindLabel}: ${name}`)
    if (filePath) parts.push(`File: ${filePath}`)
    if (signature) parts.push(`Signature: ${signature}`)

    if (body) {
      const truncatedBody = body.length > MAX_BODY_CHARS
        ? body.slice(0, MAX_BODY_CHARS) + `\n[truncated — ${body.length} chars total]`
        : body
      parts.push("")
      parts.push(truncatedBody)
    }

    const text = parts.join("\n")

    docs.push({
      entityKey: entity.id,
      text,
      metadata: {
        orgId: input.orgId,
        repoId: input.repoId,
        entityKey: entity.id,
        entityType: entity.kind,
        entityName: name,
        filePath,
        textContent: text,
      },
    })
  }

  heartbeat(`Built ${docs.length} documents from ${entities.length} entities`)
  return docs
}

/**
 * Convert entity kind to a human-readable label for embedding context.
 */
function formatKindLabel(kind: string): string {
  switch (kind) {
    case "function": return "Function"
    case "method": return "Method"
    case "class": return "Class"
    case "struct": return "Struct"
    case "interface": return "Interface"
    case "variable": return "Variable"
    case "type": return "Type"
    case "enum": return "Enum"
    case "decorator": return "Decorator"
    default: return kind.charAt(0).toUpperCase() + kind.slice(1)
  }
}

// ── generateAndStoreEmbeds ────────────────────────────────────────────────────

/**
 * Batch embed documents and store in pgvector.
 * Combines generateEmbeds + storeInPGVector into one activity for efficiency.
 * Reports progress via Temporal heartbeat.
 */
export async function generateAndStoreEmbeds(
  input: EmbeddingInput,
  documents: EmbeddableDocument[]
): Promise<{ embeddingsStored: number }> {
  const log = logger.child({ service: "embedding", organizationId: input.orgId, repoId: input.repoId })
  if (documents.length === 0) {
    log.info("No documents to embed, skipping")
    return { embeddingsStored: 0 }
  }

  log.info("Starting embedding generation", { documentCount: documents.length })
  const plog = createPipelineLogger(input.repoId, "embedding")
  plog.log("info", "Step 4/7", `Generating embeddings for ${documents.length} documents...`)
  const container = getContainer()
  const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE ?? "100", 10)
  const totalBatches = Math.ceil(documents.length / batchSize)
  let totalStored = 0

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * batchSize
    const batch = documents.slice(start, start + batchSize)

    // Generate embeddings for this batch
    const texts = batch.map((d) => d.text)
    let embeddings: number[][]

    try {
      embeddings = await container.vectorSearch.embed(texts)
    } catch (err: unknown) {
      log.warn("Batch embed failed, retrying with half batch size", {
        batchIndex,
        batchSize: batch.length,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      // On OOM or batch failure, retry with half batch size
      const halfSize = Math.ceil(batch.length / 2)
      const firstHalf = batch.slice(0, halfSize)
      const secondHalf = batch.slice(halfSize)

      const firstTexts = firstHalf.map((d) => d.text)
      const secondTexts = secondHalf.map((d) => d.text)

      const firstEmbeds = await container.vectorSearch.embed(firstTexts)
      const secondEmbeds = await container.vectorSearch.embed(secondTexts)
      embeddings = [...firstEmbeds, ...secondEmbeds]
    }

    // Store in pgvector
    const ids = batch.map((d) => d.entityKey)
    const metadata = batch.map((d) => d.metadata)
    await container.vectorSearch.upsert(ids, embeddings, metadata)

    totalStored += batch.length
    plog.log("info", "Step 4/7", `Embedding batch ${batchIndex + 1}/${totalBatches} complete (${totalStored}/${documents.length})`)

    // Report progress via heartbeat
    const progress = Math.round(((batchIndex + 1) / totalBatches) * 100)
    heartbeat({
      batchIndex: batchIndex + 1,
      totalBatches,
      entitiesProcessed: totalStored,
      totalEntities: documents.length,
      progress,
    })
  }

  log.info("Embedding generation complete", { embeddingsStored: totalStored })
  return { embeddingsStored: totalStored }
}

// ── deleteOrphanedEmbeddings ──────────────────────────────────────────────────

/**
 * Remove embeddings for entities that no longer exist in the graph store.
 * Compares current ArangoDB entity keys against pgvector entity keys.
 */
export async function deleteOrphanedEmbeddings(
  input: EmbeddingInput,
  currentEntityKeys: string[]
): Promise<{ deletedCount: number }> {
  const container = getContainer()

  if (container.vectorSearch.deleteOrphaned) {
    const deletedCount = await container.vectorSearch.deleteOrphaned(
      input.repoId,
      currentEntityKeys
    )
    heartbeat(`Deleted ${deletedCount} orphaned embeddings`)
    return { deletedCount }
  }

  return { deletedCount: 0 }
}
