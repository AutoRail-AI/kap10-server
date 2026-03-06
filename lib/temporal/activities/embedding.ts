/**
 * Phase 3: Embedding activities for the embedRepoWorkflow.
 * Runs on light-llm-queue (Vertex AI Gemini Embedding 001 — managed service, no local inference).
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
import { buildFingerprintFromEntity, fingerprintToTokens } from "@/lib/justification/structural-fingerprint"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"
import type { PipelineContext } from "@/lib/temporal/activities/pipeline-logs"
import { pipelineLogger } from "@/lib/temporal/activities/pipeline-logs"
import { logger } from "@/lib/utils/logger"

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface EmbeddingInput extends PipelineContext {}

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
 * Gemini Embedding 001 supports up to 8192 tokens (~32k chars),
 * but we cap at 10000 chars to keep pgvector upsert payloads reasonable.
 */
const MAX_BODY_CHARS = 10000

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

/** L-08: Embedding variant type — "semantic" includes justification context, "code" is pure structural. */
export type EmbeddingVariant = "semantic" | "code"

/** L-08: Suffix appended to entity key for code-only variant embeddings. */
export const CODE_VARIANT_SUFFIX = "::code"

/**
 * L-07: Build kind-aware embedding text for an entity.
 * Different entity kinds get different text strategies to maximize
 * embedding quality for semantic search.
 *
 * L-08: `variant` parameter controls what context is included:
 * - "semantic" (default): includes justification, community, fingerprint — best for intent queries
 * - "code": pure structural (name, signature, doc, body only) — best for "find similar code" queries
 */
function buildKindAwareText(
  entity: EntityDoc,
  justification?: JustificationDoc | undefined,
  variant: EmbeddingVariant = "semantic",
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
      parts.push(`${kindLabel}: ${name}`)
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

  // L-08: Justification, community, and fingerprint context only for "semantic" variant
  if (variant === "semantic") {
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

    // L-22: Structural fingerprint tokens (available after Step 4b graph-analysis)
    const fp = buildFingerprintFromEntity(entity)
    if (fp) {
      parts.push(fingerprintToTokens(fp))
    }
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

    // L-07 + L-08: Semantic variant (includes justification, community, fingerprint)
    const semanticText = buildKindAwareText(entity, justification, "semantic").join("\n")
    docs.push({
      entityKey: entity.id,
      text: semanticText,
      metadata: {
        orgId: input.orgId,
        repoId: input.repoId,
        entityKey: entity.id,
        entityType: entity.kind,
        entityName: name,
        filePath,
        textContent: semanticText,
      },
    })

    // L-08: Code-only variant (pure structural — name, signature, doc, body)
    const codeText = buildKindAwareText(entity, undefined, "code").join("\n")
    docs.push({
      entityKey: `${entity.id}${CODE_VARIANT_SUFFIX}`,
      text: codeText,
      metadata: {
        orgId: input.orgId,
        repoId: input.repoId,
        entityKey: `${entity.id}${CODE_VARIANT_SUFFIX}`,
        entityType: entity.kind,
        entityName: name,
        filePath,
        textContent: codeText,
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
  } catch (error: unknown) {
    const { logger: log } = require("@/lib/utils/logger") as typeof import("@/lib/utils/logger")
    log.warn("Failed to load justifications for embedding enrichment", { orgId, repoId, error: error instanceof Error ? error.message : String(error) })
    return new Map()
  }
}

/**
 * Embed a set of documents and store in pgvector.
 * Uses embedMany() which sends up to 2048 texts in a single Vertex AI request.
 * Sub-batches of 500 docs keep pgvector upsert transactions manageable.
 */
async function embedAndStore(
  container: Container,
  docs: EmbeddableDocument[],
  _log: ReturnType<typeof logger.child>,
  batchTag?: string,
): Promise<number> {
  const upsertBatchSize = 250 // aligned with Vertex AI embedMany batch limit (251 exclusive)
  const totalBatches = Math.ceil(docs.length / upsertBatchSize)
  let totalStored = 0
  const tag = batchTag ?? "embed"

  _log.info(`${tag}: embedAndStore starting`, {
    totalDocs: docs.length,
    subBatches: totalBatches,
    subBatchSize: upsertBatchSize,
  })

  for (let i = 0; i < totalBatches; i++) {
    const subStart = Date.now()
    const start = i * upsertBatchSize
    const batch = docs.slice(start, start + upsertBatchSize)
    const texts = batch.map((d) => d.text)

    // embedMany() sends all texts in a single HTTP request to Vertex AI
    const embedStartMs = Date.now()
    const embeddings = await container.vectorSearch.embed(texts)
    const embedMs = Date.now() - embedStartMs

    // K-10: Filter out vectors containing NaN or Infinity before upserting
    const validIndices: number[] = []
    let nanCount = 0
    for (let vi = 0; vi < embeddings.length; vi++) {
      const vec = embeddings[vi]
      if (vec && vec.every((v) => Number.isFinite(v))) {
        validIndices.push(vi)
      } else {
        nanCount++
        _log.warn("Skipping embedding with NaN/Infinity values", {
          entityKey: batch[vi]?.entityKey,
        })
      }
    }

    // Upsert to pgvector
    const upsertStartMs = Date.now()
    if (validIndices.length > 0) {
      await container.vectorSearch.upsert(
        validIndices.map((idx) => batch[idx]!.entityKey),
        validIndices.map((idx) => embeddings[idx]!),
        validIndices.map((idx) => batch[idx]!.metadata),
      )
    }
    const upsertMs = Date.now() - upsertStartMs
    totalStored += validIndices.length

    const subMs = Date.now() - subStart
    _log.info(`${tag}: sub-batch ${i + 1}/${totalBatches} complete`, {
      textsEmbedded: texts.length,
      embeddingsReturned: embeddings.length,
      validVectors: validIndices.length,
      nanFiltered: nanCount,
      upserted: validIndices.length,
      totalStoredSoFar: totalStored,
      embedMs,
      upsertMs,
      subBatchMs: subMs,
    })

    if (global.gc) global.gc()

    const mem = process.memoryUsage()
    heartbeat({
      subBatch: i + 1,
      totalSubBatches: totalBatches,
      stored: totalStored,
      rssMB: Math.round(mem.rss / 1024 / 1024),
    })
  }

  _log.info(`${tag}: embedAndStore complete`, {
    totalStored,
    totalDocs: docs.length,
  })

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
  const plog = pipelineLogger(input, "embedding")
  const container = getContainer()

  const startMs = Date.now()
  plog.log("info", "Step 2/7", "Fetching file paths from graph store...")
  const filePaths = await container.graphStore.getFilePaths(input.orgId, input.repoId)
  const paths = filePaths.map((f) => f.path)
  const fetchMs = Date.now() - startMs

  // Extension distribution for debugging
  const extCounts: Record<string, number> = {}
  for (const p of paths) {
    const ext = p.split(".").pop() ?? "no-ext"
    extCounts[ext] = (extCounts[ext] ?? 0) + 1
  }
  const topExts = Object.entries(extCounts).sort(([, a], [, b]) => b - a).slice(0, 10)

  log.info("Fetched file paths for embedding", {
    fileCount: paths.length,
    fetchDurationMs: fetchMs,
    fileExtensions: Object.fromEntries(topExts),
    samplePaths: paths.slice(0, 5),
  })
  plog.log("info", "Step 2/7", `Found ${paths.length} files (${topExts.map(([e, c]) => `${c} .${e}`).join(", ")}) in ${fetchMs}ms`)
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
  const batchTag = `Batch ${batchLabel.index + 1}/${batchLabel.total}`
  const log = logger.child({
    service: "embedding",
    organizationId: input.orgId,
    repoId: input.repoId,
    batch: batchTag,
  })
  const plog = pipelineLogger(input, "embedding")
  const container = getContainer()
  const batchStartMs = Date.now()

  log.info("━━━ BATCH START ━━━", {
    fileCount: filePaths.length,
    firstFile: filePaths[0],
    lastFile: filePaths[filePaths.length - 1],
  })

  // ── Step 1: Fetch entities per file ────────────────────────────────────────
  const fetchStartMs = Date.now()
  const allEntities: EntityDoc[] = []
  const filesWithNoEntities: string[] = []
  const entityCountPerFile: Record<string, number> = {}

  for (const path of filePaths) {
    const entities = await container.graphStore.getEntitiesByFile(
      input.orgId,
      input.repoId,
      path,
    )
    entityCountPerFile[path] = entities.length
    if (entities.length === 0) {
      filesWithNoEntities.push(path)
    }
    allEntities.push(...entities)
  }
  const fetchMs = Date.now() - fetchStartMs

  // Log files with suspiciously high entity counts (> 50 per file)
  const hotFiles = Object.entries(entityCountPerFile)
    .filter(([, count]) => count > 50)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)

  log.info("Step 1: Entities fetched from ArangoDB", {
    totalEntities: allEntities.length,
    filesProcessed: filePaths.length,
    filesWithZeroEntities: filesWithNoEntities.length,
    avgEntitiesPerFile: Math.round(allEntities.length / filePaths.length),
    fetchDurationMs: fetchMs,
    hotFiles: hotFiles.length > 0 ? hotFiles.map(([f, c]) => `${f} (${c})`) : "none (all ≤50)",
  })
  heartbeat(`${batchTag}: fetched ${allEntities.length} entities from ${filePaths.length} files`)

  // ── Step 2: Diagnose duplicate entities ────────────────────────────────────
  // Track entity IDs to detect cross-file duplicates. We do NOT dedup here —
  // we log diagnostics so we can fix the root cause (SCIP cross-refs, etc.)
  const entityIdCounts = new Map<string, { count: number; files: string[]; kind: string }>()
  for (const entity of allEntities) {
    const existing = entityIdCounts.get(entity.id)
    if (existing) {
      existing.count++
      if (existing.files.length < 3) existing.files.push(entity.file_path ?? "?")
    } else {
      entityIdCounts.set(entity.id, { count: 1, files: [entity.file_path ?? "?"], kind: entity.kind })
    }
  }
  const duplicateEntities = [...entityIdCounts.entries()]
    .filter(([, v]) => v.count > 1)
    .sort(([, a], [, b]) => b.count - a.count)
  const uniqueEntityCount = entityIdCounts.size
  const duplicateEntityCount = allEntities.length - uniqueEntityCount

  // Kind distribution for debugging
  const kindCounts: Record<string, number> = {}
  for (const e of allEntities) {
    kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1
  }

  log.info("Step 2: Entity diagnostics", {
    totalRaw: allEntities.length,
    uniqueEntities: uniqueEntityCount,
    duplicateEntities: duplicateEntityCount,
    duplicatePercentage: `${Math.round((duplicateEntityCount / (allEntities.length || 1)) * 100)}%`,
    kindDistribution: kindCounts,
    topDuplicates: duplicateEntities.slice(0, 5).map(([id, v]) => ({
      entityId: id.slice(0, 16),
      kind: v.kind,
      seenInFiles: v.count,
      files: v.files,
    })),
  })

  // Pipeline log (visible on UI) — concise summary
  if (duplicateEntityCount > 0) {
    plog.log(
      "warn",
      "Step 3/7",
      `${batchTag}: ${allEntities.length} raw entities, ${uniqueEntityCount} unique, ${duplicateEntityCount} duplicates (${Math.round((duplicateEntityCount / allEntities.length) * 100)}%) — top kinds: ${Object.entries(kindCounts).sort(([, a], [, b]) => b - a).map(([k, c]) => `${c} ${k}`).join(", ")}`,
    )
  }

  // ── Step 3: Build embeddable documents ─────────────────────────────────────
  const buildStartMs = Date.now()
  const justificationMap = await loadJustificationMap(container, input.orgId, input.repoId)
  const docs = buildEmbeddableDocuments(input, allEntities, justificationMap)

  // Fallback embeddings for files with NO code entities
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
  const buildMs = Date.now() - buildStartMs

  const semanticDocs = docs.filter((d) => !d.entityKey.endsWith(CODE_VARIANT_SUFFIX)).length
  const codeDocs = docs.filter((d) => d.entityKey.endsWith(CODE_VARIANT_SUFFIX)).length
  const fileDocs = docs.filter((d) => d.metadata.entityType === "file").length
  const totalTextChars = docs.reduce((sum, d) => sum + d.text.length, 0)

  log.info("Step 3: Documents built for embedding", {
    totalDocs: docs.length,
    semanticVariants: semanticDocs,
    codeVariants: codeDocs,
    fileFallbacks: fileDocs,
    justificationsAvailable: justificationMap.size,
    justificationsMatched: [...justificationMap.keys()].filter((k) => entityIdCounts.has(k)).length,
    totalTextChars,
    avgTextChars: Math.round(totalTextChars / (docs.length || 1)),
    buildDurationMs: buildMs,
    docsPerUniqueEntity: uniqueEntityCount > 0 ? (docs.length / uniqueEntityCount).toFixed(1) : "0",
  })

  if (docs.length === 0) {
    log.info("No embeddable entities in batch, skipping")
    return { embeddingsStored: 0 }
  }

  heartbeat(`${batchTag}: embedding ${docs.length} docs (${allEntities.length} raw entities, ${uniqueEntityCount} unique)`)

  // ── Step 4: Embed + store in pgvector ──────────────────────────────────────
  const embedStartMs = Date.now()
  const stored = await embedAndStore(container, docs, log, batchTag)
  const embedMs = Date.now() - embedStartMs

  const totalMs = Date.now() - batchStartMs
  const summary = `${batchTag}: ${stored} stored | ${allEntities.length} raw entities (${uniqueEntityCount} unique, ${duplicateEntityCount} dupes) → ${docs.length} docs | fetch=${fetchMs}ms build=${buildMs}ms embed=${embedMs}ms total=${totalMs}ms`

  plog.log("info", "Step 3/7", summary)
  log.info("━━━ BATCH COMPLETE ━━━", {
    embeddingsStored: stored,
    rawEntities: allEntities.length,
    uniqueEntities: uniqueEntityCount,
    duplicateEntities: duplicateEntityCount,
    docsBuilt: docs.length,
    fetchMs,
    buildMs,
    embedMs,
    totalMs,
    throughput: `${Math.round((stored / (totalMs / 1000)) * 10) / 10} embeds/sec`,
  })

  // Free large arrays
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
  const plog = pipelineLogger(input, "embedding")
  const container = getContainer()
  const startMs = Date.now()

  log.info("Orphan cleanup: starting entity key collection from graph store")

  // Build the current entity key set by paginating through files.
  const currentEntityKeys: string[] = []
  const filePaths = await container.graphStore.getFilePaths(input.orgId, input.repoId)
  const fetchPathsMs = Date.now() - startMs

  log.info("Orphan cleanup: file paths fetched", { fileCount: filePaths.length, fetchMs: fetchPathsMs })

  let entityScanCount = 0
  let filesWithNoEntities = 0
  const entityKeyStartMs = Date.now()

  for (const { path } of filePaths) {
    const entities = await container.graphStore.getEntitiesByFile(
      input.orgId,
      input.repoId,
      path,
    )
    entityScanCount += entities.length

    for (const entity of entities) {
      if (entity.kind !== "file" && entity.kind !== "directory") {
        currentEntityKeys.push(entity.id)
        currentEntityKeys.push(`${entity.id}${CODE_VARIANT_SUFFIX}`)
      }
    }

    if (entities.length === 0) {
      currentEntityKeys.push(`file:${path}`)
      filesWithNoEntities++
    }

    if (currentEntityKeys.length % 200 === 0) {
      heartbeat(`Collecting entity keys: ${currentEntityKeys.length} so far from ${filePaths.length} files`)
    }
  }

  const entityKeyMs = Date.now() - entityKeyStartMs
  log.info("Orphan cleanup: entity keys collected", {
    totalKeys: currentEntityKeys.length,
    entitiesScanned: entityScanCount,
    filesWithEntities: filePaths.length - filesWithNoEntities,
    filesWithNoEntities,
    collectionDurationMs: entityKeyMs,
  })
  plog.log("info", "Orphan Cleanup", `Collected ${currentEntityKeys.length} valid entity keys from ${filePaths.length} files (${entityScanCount} entities scanned) in ${entityKeyMs}ms`)
  heartbeat(`Collected ${currentEntityKeys.length} entity keys, deleting orphans...`)

  const deleteStartMs = Date.now()
  const deletedCount = await container.vectorSearch.deleteOrphaned(
    input.repoId,
    currentEntityKeys,
  )
  const deleteMs = Date.now() - deleteStartMs
  const totalMs = Date.now() - startMs

  log.info("Orphan cleanup: complete", {
    deletedCount,
    totalKeys: currentEntityKeys.length,
    deleteMs,
    totalMs,
  })
  heartbeat(`Deleted ${deletedCount} orphaned embeddings`)
  plog.log("info", "Orphan Cleanup", `Removed ${deletedCount} orphaned embeddings in ${deleteMs}ms (total orphan cleanup: ${totalMs}ms)`)
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
  const plog = pipelineLogger(input, "embedding")
  const container = getContainer()
  const pass2StartMs = Date.now()

  log.info("━━━ PASS 2: RE-EMBED WITH JUSTIFICATIONS ━━━")
  plog.log("info", "Pass 2", "Starting re-embedding with justification context...")

  // Load justification map (now fully populated after justify-repo)
  const justLoadStart = Date.now()
  const justificationMap = await loadJustificationMap(container, input.orgId, input.repoId)
  const justLoadMs = Date.now() - justLoadStart
  log.info("Pass 2: Justifications loaded", {
    justificationCount: justificationMap.size,
    loadMs: justLoadMs,
    sampleKeys: [...justificationMap.keys()].slice(0, 5),
  })
  heartbeat(`Loaded ${justificationMap.size} justifications`)

  if (justificationMap.size === 0) {
    log.info("Pass 2: No justifications found, skipping re-embed")
    plog.log("info", "Pass 2", "No justifications available — skipping re-embedding")
    return { embeddingsStored: 0 }
  }

  // Fetch all file paths
  const filePaths = await container.graphStore.getFilePaths(input.orgId, input.repoId)
  const FILE_BATCH_SIZE = 50
  const totalPass2Batches = Math.ceil(filePaths.length / FILE_BATCH_SIZE)
  let totalStored = 0

  log.info("Pass 2: Starting batch processing", {
    fileCount: filePaths.length,
    batchSize: FILE_BATCH_SIZE,
    totalBatches: totalPass2Batches,
  })
  plog.log("info", "Pass 2", `Re-embedding ${filePaths.length} files with ${justificationMap.size} justifications (${totalPass2Batches} batches)`)

  for (let i = 0; i < filePaths.length; i += FILE_BATCH_SIZE) {
    const batchNum = Math.floor(i / FILE_BATCH_SIZE) + 1
    const batchStartMs = Date.now()
    const batch = filePaths.slice(i, i + FILE_BATCH_SIZE)
    const allEntities: EntityDoc[] = []

    for (const { path } of batch) {
      const entities = await container.graphStore.getEntitiesByFile(input.orgId, input.repoId, path)
      allEntities.push(...entities)
    }

    const docs = buildEmbeddableDocuments(input, allEntities, justificationMap)
    const justificationsUsed = allEntities.filter((e) => justificationMap.has(e.id)).length

    if (docs.length > 0) {
      const stored = await embedAndStore(container, docs, log, `Pass2-Batch${batchNum}`)
      totalStored += stored
    }

    const batchMs = Date.now() - batchStartMs
    log.info(`Pass 2: batch ${batchNum}/${totalPass2Batches} complete`, {
      entities: allEntities.length,
      docs: docs.length,
      justificationsUsed,
      stored: totalStored,
      batchMs,
    })

    // Free memory
    allEntities.length = 0
    if (global.gc) global.gc()

    heartbeat({
      pass2Batch: batchNum,
      totalBatches: totalPass2Batches,
      stored: totalStored,
    })
  }

  const pass2Ms = Date.now() - pass2StartMs
  const summary = `Pass 2 complete: ${totalStored} re-embedded with justification context in ${Math.round(pass2Ms / 1000)}s (${filePaths.length} files, ${totalPass2Batches} batches, ${justificationMap.size} justifications)`
  plog.log("info", "Pass 2", summary)
  log.info("━━━ PASS 2 COMPLETE ━━━", {
    embeddingsStored: totalStored,
    totalMs: pass2Ms,
    justificationCount: justificationMap.size,
    fileCount: filePaths.length,
  })

  return { embeddingsStored: totalStored }
}

// ── Legacy Activities (kept for backward compatibility / tests) ───────────────

/** @deprecated Use fetchFilePaths + processAndEmbedBatch instead. */
export async function fetchEntities(input: EmbeddingInput): Promise<EntityDoc[]> {
  const log = logger.child({ service: "embedding", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "embedding")
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
  const plog = pipelineLogger(input, "embedding")
  plog.log("info", "Step 4/7", `Generating embeddings for ${documents.length} documents...`)

  const container = getContainer()
  const stored = await embedAndStore(container, documents, log)

  log.info("Embedding generation complete", { embeddingsStored: stored })
  return { embeddingsStored: stored }
}
