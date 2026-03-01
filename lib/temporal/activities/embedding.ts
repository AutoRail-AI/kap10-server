/**
 * Phase 3: Embedding activities for the embedRepoWorkflow.
 * Runs on light-llm-queue (CPU-bound ONNX inference, no GPU needed).
 *
 * Primary activities (chunked — avoids large Temporal payloads):
 *   - setEmbeddingStatus: Set repo status to "embedding"
 *   - fetchFilePaths: Return lightweight file path list for workflow-level chunking
 *   - processAndEmbedBatch: Fetch entities → build docs → embed → store for a batch of files
 *   - deleteOrphanedEmbeddingsFromGraph: DB-side orphan cleanup (no large arrays through Temporal)
 *   - deleteOrphanedEmbeddings: (deprecated) Remove stale embeddings with passed-in key array
 *   - setReadyStatus: Set repo status to "ready"
 *   - setEmbedFailedStatus: Set repo status to "embed_failed"
 *
 * Legacy activities (kept for backwards compatibility / tests):
 *   - fetchEntities, buildDocuments, generateAndStoreEmbeds
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"
import { summarizeBody } from "@/lib/justification/ast-summarizer"
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
 * L-07: Build kind-aware embedding text for an entity.
 * Different entity kinds get different text strategies to maximize
 * embedding quality for semantic search.
 */
function buildKindAwareText(
  entity: EntityDoc,
  justification?: JustificationDoc | undefined,
): string[] {
  const kindLabel = formatKindLabel(entity.kind)
  const name = entity.name ?? "unknown"
  const filePath = entity.file_path ?? ""
  const signature = (entity.signature as string) ?? ""
  const body = (entity.body as string) ?? ""
  const doc = (entity.doc as string) ?? ""

  const parts: string[] = []

  switch (entity.kind) {
    case "class":
    case "struct": {
      parts.push(`Class: ${name}`)
      if (filePath) parts.push(`File: ${filePath}`)
      const parent = (entity.parent as string) ?? ""
      if (parent) parts.push(`Extends: ${parent}`)
      const methods = (entity.methods as string[]) ?? []
      if (methods.length > 0) parts.push(`Methods: ${methods.slice(0, 15).join(", ")}${methods.length > 15 ? ` and ${methods.length - 15} more` : ""}`)
      if (signature) parts.push(`Signature: ${signature}`)
      if (doc) parts.push(`Documentation: ${doc}`)
      break
    }
    case "interface": {
      parts.push(`Interface: ${name}`)
      if (filePath) parts.push(`File: ${filePath}`)
      if (signature) parts.push(`Contract: ${signature}`)
      if (doc) parts.push(`Documentation: ${doc}`)
      break
    }
    case "module":
    case "namespace": {
      parts.push(`Module: ${name}`)
      if (filePath) parts.push(`File: ${filePath}`)
      const exports = (entity.exports as string[]) ?? []
      if (exports.length > 0) parts.push(`Exports: ${exports.slice(0, 20).join(", ")}`)
      if (doc) parts.push(`Documentation: ${doc}`)
      // Modules don't embed code body — just their export surface
      break
    }
    default: {
      // function, method, variable, type, enum, decorator — current strategy
      parts.push(`${kindLabel}: ${name}`)
      if (filePath) parts.push(`File: ${filePath}`)
      if (signature) parts.push(`Signature: ${signature}`)
      if (doc) parts.push(`Documentation: ${doc}`)
      break
    }
  }

  // Justification context (available in Pass 2, empty in Pass 1)
  if (justification) {
    parts.push(`Purpose: ${justification.business_purpose}`)
    if (justification.domain_concepts.length > 0) {
      parts.push(`Domain: ${justification.domain_concepts.join(", ")}`)
    }
    parts.push(`Feature: ${justification.feature_tag}`)
  }

  // Community label from entity metadata
  const communityLabel = (entity as Record<string, unknown>).community_label as string | undefined
  if (communityLabel) {
    parts.push(`Community: ${communityLabel}`)
  }

  // Code body (skip for modules/namespaces which embed export surface only)
  if (body && entity.kind !== "module" && entity.kind !== "namespace") {
    const summarized = summarizeBody(body, MAX_BODY_CHARS)
    parts.push("")
    parts.push(summarized.text)
  }

  return parts
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
    // L-07: Re-include modules/namespaces (they get export-surface embeddings).
    // Only exclude file and directory kinds — they get fallback file-level embeddings.
    if (entity.kind === "file" || entity.kind === "directory") {
      continue
    }

    const name = entity.name ?? "unknown"
    const filePath = entity.file_path ?? ""
    const justification = justificationMap.get(entity.id)

    // L-07: Kind-aware text construction
    const text = buildKindAwareText(entity, justification).join("\n")

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

    // K-10: Filter out vectors containing NaN or Infinity before upserting
    const validIndices: number[] = []
    for (let vi = 0; vi < embeddings.length; vi++) {
      const vec = embeddings[vi]
      if (vec && vec.every((v) => Number.isFinite(v))) {
        validIndices.push(vi)
      } else {
        _log.warn("Skipping embedding with NaN/Infinity values", {
          entityKey: batch[vi]?.entityKey,
        })
      }
    }

    if (validIndices.length > 0) {
      await container.vectorSearch.upsert(
        validIndices.map((idx) => batch[idx]!.entityKey),
        validIndices.map((idx) => embeddings[idx]!),
        validIndices.map((idx) => batch[idx]!.metadata),
      )
    }
    totalStored += validIndices.length

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
): Promise<{ embeddingsStored: number }> {
  const log = logger.child({
    service: "embedding",
    organizationId: input.orgId,
    repoId: input.repoId,
    fileBatch: `${batchLabel.index + 1}/${batchLabel.total}`,
  })
  const plog = createPipelineLogger(input.repoId, "embedding")
  const container = getContainer()

  log.info("Processing file batch", { fileCount: filePaths.length })

  // 1. Fetch entities for this batch of files — one file at a time, never bulk-load
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
    return { embeddingsStored: 0 }
  }

  // 3. Embed + store in pgvector (sub-batched internally)
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

  return { embeddingsStored: stored }
}

// ── deleteOrphanedEmbeddingsFromGraph ──────────────────────────────────────────

/**
 * Remove embeddings for entities that no longer exist in the graph store.
 * Queries the graph store for current entity keys DB-side (paginated) and
 * passes them to the vector store for orphan deletion. This avoids
 * accumulating all entity keys in the workflow's Temporal history.
 */
export async function deleteOrphanedEmbeddingsFromGraph(
  input: EmbeddingInput,
): Promise<{ deletedCount: number }> {
  const log = logger.child({ service: "embedding", organizationId: input.orgId, repoId: input.repoId })
  const plog = createPipelineLogger(input.repoId, "embedding")
  const container = getContainer()

  // Build the current entity key set by paginating through files.
  // We fetch one file at a time to avoid loading all entities into memory.
  const currentEntityKeys: string[] = []
  const filePaths = await container.graphStore.getFilePaths(input.orgId, input.repoId)

  for (const { path } of filePaths) {
    const entities = await container.graphStore.getEntitiesByFile(
      input.orgId,
      input.repoId,
      path,
    )

    for (const entity of entities) {
      // L-07: modules/namespaces now get embeddings, only exclude file/directory
      if (entity.kind !== "file" && entity.kind !== "directory") {
        currentEntityKeys.push(entity.id)
      }
    }

    // Also add file-level key for files without code entities
    if (entities.length === 0) {
      currentEntityKeys.push(`file:${path}`)
    }

    // Heartbeat every 50 files to stay alive
    if (currentEntityKeys.length % 50 === 0) {
      heartbeat(`Collecting entity keys: ${currentEntityKeys.length} so far`)
    }
  }

  log.info("Collected current entity keys for orphan detection", { keyCount: currentEntityKeys.length })
  plog.log("info", "Orphan Cleanup", `Collected ${currentEntityKeys.length} entity keys, scanning for orphaned embeddings...`)
  heartbeat(`Collected ${currentEntityKeys.length} entity keys, deleting orphans...`)

  const deletedCount = await container.vectorSearch.deleteOrphaned(
    input.repoId,
    currentEntityKeys,
  )

  heartbeat(`Deleted ${deletedCount} orphaned embeddings`)
  plog.log("info", "Orphan Cleanup", `Removed ${deletedCount} orphaned embeddings from vector store`)
  log.info("Orphaned embeddings deleted", { deletedCount })
  return { deletedCount }
}

/** @deprecated Use deleteOrphanedEmbeddingsFromGraph instead — avoids passing large arrays through Temporal. */
export async function deleteOrphanedEmbeddings(
  input: EmbeddingInput,
  currentEntityKeys: string[]
): Promise<{ deletedCount: number }> {
  const container = getContainer()

  const deletedCount = await container.vectorSearch.deleteOrphaned(
    input.repoId,
    currentEntityKeys
  )
  heartbeat(`Deleted ${deletedCount} orphaned embeddings`)
  return { deletedCount }
}

// ── Pass 2: Re-embed with Justification Context (L-07) ───────────────────────

/**
 * L-07 Pass 2: Re-embed all entities with justification, domain, and community
 * context. Called after justify-repo completes so that justificationMap is
 * guaranteed to be populated.
 *
 * Processes files in batches to avoid memory pressure. Reuses the same
 * buildEmbeddableDocuments + embedAndStore pipeline as Pass 1.
 */
export async function reEmbedWithJustifications(
  input: EmbeddingInput
): Promise<{ embeddingsStored: number }> {
  const log = logger.child({ service: "embedding-pass2", organizationId: input.orgId, repoId: input.repoId })
  const plog = createPipelineLogger(input.repoId, "embedding")
  const container = getContainer()

  plog.log("info", "Pass 2", "Starting re-embedding with justification context...")
  log.info("Pass 2: Starting re-embed with justifications")

  // Load justification map (now fully populated after justify-repo)
  const justificationMap = await loadJustificationMap(container, input.orgId, input.repoId)
  log.info("Pass 2: Loaded justifications", { justificationCount: justificationMap.size })
  heartbeat(`Loaded ${justificationMap.size} justifications`)

  if (justificationMap.size === 0) {
    log.info("Pass 2: No justifications found, skipping re-embed")
    return { embeddingsStored: 0 }
  }

  // Fetch all file paths
  const filePaths = await container.graphStore.getFilePaths(input.orgId, input.repoId)
  const FILE_BATCH_SIZE = 50
  let totalStored = 0

  for (let i = 0; i < filePaths.length; i += FILE_BATCH_SIZE) {
    const batch = filePaths.slice(i, i + FILE_BATCH_SIZE)
    const allEntities: EntityDoc[] = []

    for (const { path } of batch) {
      const entities = await container.graphStore.getEntitiesByFile(input.orgId, input.repoId, path)
      allEntities.push(...entities)
    }

    const docs = buildEmbeddableDocuments(input, allEntities, justificationMap)
    if (docs.length > 0) {
      const stored = await embedAndStore(container, docs, log)
      totalStored += stored
    }

    // Free memory
    allEntities.length = 0
    if (global.gc) global.gc()

    heartbeat({
      pass2Batch: Math.floor(i / FILE_BATCH_SIZE) + 1,
      totalBatches: Math.ceil(filePaths.length / FILE_BATCH_SIZE),
      stored: totalStored,
    })
  }

  plog.log("info", "Pass 2", `Re-embedded ${totalStored} entities with justification context`)
  log.info("Pass 2 complete", { embeddingsStored: totalStored })

  return { embeddingsStored: totalStored }
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
