/**
 * Phase 3: Embedding activities for the embedRepoWorkflow.
 * Runs on light-llm-queue (CPU-bound ONNX inference, no GPU needed).
 *
 * Primary activities (chunked — avoids large Temporal payloads):
 *   - setEmbeddingStatus: Set repo status to "embedding"
 *   - fetchFilePaths: Return lightweight file path list for workflow-level chunking
 *   - processAndEmbedBatch: Fetch entities → build docs → embed → store for a batch of files
 *   - deleteOrphanedEmbeddings: Remove stale embeddings for deleted entities
 *   - setReadyStatus: Set repo status to "ready"
 *   - setEmbedFailedStatus: Set repo status to "embed_failed"
 *
 * Legacy activities (kept for backwards compatibility / tests):
 *   - fetchEntities, buildDocuments, generateAndStoreEmbeds
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"
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

// ── Helpers (pure functions, not activities) ──────────────────────────────────

/**
 * Max chars for entity body before truncation.
 * 2000 chars ≈ 500 tokens. Combined with EMBEDDING_MAX_TOKENS=512 tokenizer
 * truncation in the adapter, this ensures ONNX never processes sequences
 * long enough to cause quadratic attention memory blowup.
 */
const MAX_BODY_CHARS = 2000

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

/**
 * Pure helper: transform entities into embeddable documents.
 * Extracted from the old `buildDocuments` activity so it can be reused
 * inside `processAndEmbedBatch` without an extra Temporal round-trip.
 */
export function buildEmbeddableDocuments(
  input: EmbeddingInput,
  entities: EntityDoc[],
  justificationMap: Map<string, JustificationDoc>,
): EmbeddableDocument[] {
  const docs: EmbeddableDocument[] = []

  for (const entity of entities) {
    if (entity.kind === "file" || entity.kind === "directory" || entity.kind === "module" || entity.kind === "namespace") {
      continue
    }

    const kindLabel = formatKindLabel(entity.kind)
    const name = entity.name ?? "unknown"
    const filePath = entity.file_path ?? ""
    const signature = (entity.signature as string) ?? ""
    const body = (entity.body as string) ?? ""

    const doc = (entity.doc as string) ?? ""

    const parts: string[] = []
    parts.push(`${kindLabel}: ${name}`)
    if (filePath) parts.push(`File: ${filePath}`)
    if (signature) parts.push(`Signature: ${signature}`)
    if (doc) parts.push(`Documentation: ${doc}`)

    const justification = justificationMap.get(entity.id)
    if (justification) {
      parts.push(`Purpose: ${justification.business_purpose}`)
      if (justification.domain_concepts.length > 0) {
        parts.push(`Domain: ${justification.domain_concepts.join(", ")}`)
      }
      parts.push(`Feature: ${justification.feature_tag}`)
    }

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

  return docs
}

/**
 * Fetch justifications for a repo, returning a map keyed by entity_id.
 * Returns empty map on failure (first index may not have justifications yet).
 */
async function loadJustificationMap(
  container: Container,
  orgId: string,
  repoId: string,
): Promise<Map<string, JustificationDoc>> {
  try {
    const justifications = await container.graphStore.getJustifications(orgId, repoId)
    return new Map(justifications.map((j) => [j.entity_id, j]))
  } catch {
    return new Map()
  }
}

/**
 * Embed a set of documents and store in pgvector.
 * The adapter processes one doc at a time with token truncation (O(n²)-safe).
 * We chunk into small DB-upsert batches of UPSERT_BATCH_SIZE for heartbeats.
 */
async function embedAndStore(
  container: Container,
  docs: EmbeddableDocument[],
  _log: ReturnType<typeof logger.child>,
): Promise<number> {
  const upsertBatchSize = 10
  const totalBatches = Math.ceil(docs.length / upsertBatchSize)
  let totalStored = 0

  for (let i = 0; i < totalBatches; i++) {
    const start = i * upsertBatchSize
    const batch = docs.slice(start, start + upsertBatchSize)
    const texts = batch.map((d) => d.text)

    // embed() processes one doc at a time internally — memory safe
    const embeddings = await container.vectorSearch.embed(texts)

    await container.vectorSearch.upsert(
      batch.map((d) => d.entityKey),
      embeddings,
      batch.map((d) => d.metadata),
    )
    totalStored += batch.length

    if (global.gc) global.gc()

    const mem = process.memoryUsage()
    heartbeat({
      subBatch: i + 1,
      totalSubBatches: totalBatches,
      stored: totalStored,
      rssMB: Math.round(mem.rss / 1024 / 1024),
    })
  }

  return totalStored
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
    lastIndexedAt: new Date(),
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

// ── Primary Activities (chunked) ──────────────────────────────────────────────

/**
 * Return the list of file paths for a repo. This is lightweight (string[])
 * so it can safely pass through Temporal's data converter, enabling the
 * workflow to chunk paths and fan out to processAndEmbedBatch.
 */
export async function fetchFilePaths(input: EmbeddingInput): Promise<string[]> {
  const log = logger.child({ service: "embedding", organizationId: input.orgId, repoId: input.repoId })
  const plog = createPipelineLogger(input.repoId, "embedding")
  const container = getContainer()

  plog.log("info", "Step 2/7", "Fetching file paths from graph store...")
  const filePaths = await container.graphStore.getFilePaths(input.orgId, input.repoId)
  const paths = filePaths.map((f) => f.path)

  log.info("Fetched file paths for embedding", { fileCount: paths.length })
  plog.log("info", "Step 2/7", `Found ${paths.length} files to process`)
  heartbeat(`Found ${paths.length} files`)
  return paths
}

/**
 * Combined activity: for a batch of file paths, fetch entities, build
 * embeddable documents, generate embeddings, and store in pgvector.
 *
 * This keeps large payloads (entity bodies, document text, embeddings) inside
 * the worker and never serializes them through Temporal's data converter.
 * Only lightweight inputs (file paths) and outputs (entity keys + count)
 * cross the Temporal boundary.
 */
export async function processAndEmbedBatch(
  input: EmbeddingInput,
  filePaths: string[],
  batchLabel: { index: number; total: number },
): Promise<{ embeddingsStored: number; entityKeys: string[] }> {
  const log = logger.child({
    service: "embedding",
    organizationId: input.orgId,
    repoId: input.repoId,
    fileBatch: `${batchLabel.index + 1}/${batchLabel.total}`,
  })
  const plog = createPipelineLogger(input.repoId, "embedding")
  const container = getContainer()

  log.info("Processing file batch", { fileCount: filePaths.length })

  // 1. Fetch entities for this batch of files
  const allEntities: EntityDoc[] = []
  const filesWithNoEntities: string[] = []
  for (const path of filePaths) {
    const entities = await container.graphStore.getEntitiesByFile(
      input.orgId,
      input.repoId,
      path,
    )
    if (entities.length === 0) {
      filesWithNoEntities.push(path)
    }
    allEntities.push(...entities)
  }
  heartbeat(`Fetched ${allEntities.length} entities from ${filePaths.length} files`)

  // 2. Build embeddable documents from code entities
  const justificationMap = await loadJustificationMap(container, input.orgId, input.repoId)
  const docs = buildEmbeddableDocuments(input, allEntities, justificationMap)

  // 2b. Create fallback embeddings for files with NO code entities (config, text, etc.)
  // This ensures every indexed file is searchable via semantic search.
  for (const filePath of filesWithNoEntities) {
    const fileName = filePath.split("/").pop() ?? filePath
    const fileKey = `file:${filePath}`
    docs.push({
      entityKey: fileKey,
      text: `File: ${filePath}\nName: ${fileName}`,
      metadata: {
        orgId: input.orgId,
        repoId: input.repoId,
        entityKey: fileKey,
        entityType: "file",
        entityName: fileName,
        filePath,
        textContent: `File: ${filePath}`,
      },
    })
  }

  if (docs.length === 0) {
    log.info("No embeddable entities in batch, skipping")
    return { embeddingsStored: 0, entityKeys: [] }
  }

  // 3. Embed + store in pgvector (sub-batched internally)
  const entityKeys = docs.map((d) => d.entityKey)
  const stored = await embedAndStore(container, docs, log)

  plog.log(
    "info",
    "Step 3/7",
    `Batch ${batchLabel.index + 1}/${batchLabel.total}: embedded ${stored} entities from ${filePaths.length} files`,
  )
  log.info("File batch complete", { embeddingsStored: stored, entityCount: allEntities.length })

  // Free large arrays before returning — prevents memory buildup across batches
  allEntities.length = 0
  docs.length = 0
  if (global.gc) global.gc()

  return { embeddingsStored: stored, entityKeys }
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

// ── Legacy Activities (kept for backward compatibility / tests) ───────────────

/** @deprecated Use fetchFilePaths + processAndEmbedBatch instead. */
export async function fetchEntities(input: EmbeddingInput): Promise<EntityDoc[]> {
  const log = logger.child({ service: "embedding", organizationId: input.orgId, repoId: input.repoId })
  const plog = createPipelineLogger(input.repoId, "embedding")
  const container = getContainer()
  plog.log("info", "Step 2/7", "Fetching entities from graph store...")

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

/** @deprecated Use fetchFilePaths + processAndEmbedBatch instead. */
export async function buildDocuments(
  input: EmbeddingInput,
  entities: EntityDoc[]
): Promise<EmbeddableDocument[]> {
  const container = getContainer()
  const justificationMap = await loadJustificationMap(container, input.orgId, input.repoId)
  const docs = buildEmbeddableDocuments(input, entities, justificationMap)
  heartbeat(`Built ${docs.length} documents from ${entities.length} entities`)
  return docs
}

/** @deprecated Use fetchFilePaths + processAndEmbedBatch instead. */
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
  const stored = await embedAndStore(container, documents, log)

  log.info("Embedding generation complete", { embeddingsStored: stored })
  return { embeddingsStored: stored }
}
