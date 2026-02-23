/**
 * Phase 5: Temporal activities for incremental indexing.
 * Split between heavy-compute-queue (CPU-bound) and light-llm-queue (network-bound).
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { diffEntitySets } from "@/lib/indexer/incremental"
import { repairEdges } from "@/lib/indexer/edge-repair"
import { buildCascadeQueue } from "@/lib/indexer/cascade"
import { clearCallerCountCache } from "@/lib/indexer/centrality"
import { withQuarantine } from "@/lib/indexer/quarantine"
import { entityHash } from "@/lib/indexer/entity-hash"
import type { ChangedFile, EntityDiff, EntityDoc, EdgeDoc, IndexEventDoc } from "@/lib/ports/types"
import { LLM_MODELS } from "@/lib/llm/config"

export interface PullAndDiffInput {
  orgId: string
  repoId: string
  workspacePath: string
  beforeSha: string
  afterSha: string
  branch: string
  installationId: number
}

export interface PullAndDiffResult {
  changedFiles: ChangedFile[]
  afterSha: string
}

/**
 * Pull latest changes and compute file diff.
 * Runs on heavy-compute-queue (uses git operations).
 */
export async function pullAndDiff(input: PullAndDiffInput): Promise<PullAndDiffResult> {
  const container = getContainer()
  heartbeat("pulling latest")

  await container.gitHost.pullLatest(input.workspacePath, input.branch)
  heartbeat("computing diff")

  const changedFiles = await container.gitHost.diffFiles(
    input.workspacePath,
    input.beforeSha,
    input.afterSha
  )

  return { changedFiles, afterSha: input.afterSha }
}

export interface ReIndexBatchInput {
  orgId: string
  repoId: string
  workspacePath: string
  filePaths: string[]
}

export interface ReIndexBatchResult {
  entities: EntityDoc[]
  edges: Array<{ _from: string; _to: string; kind: string; org_id: string; repo_id: string }>
  quarantined: Array<{ filePath: string; reason: string }>
}

/**
 * Re-index a batch of changed files to extract entities and edges.
 * Runs on heavy-compute-queue (CPU-bound extraction).
 * Uses the same language plugin pipeline as parseRest.
 */
export async function reIndexBatch(input: ReIndexBatchInput): Promise<ReIndexBatchResult> {
  const fs = require("node:fs") as typeof import("node:fs")
  const path = require("node:path") as typeof import("node:path")
  const { getPluginForExtension } = require("@/lib/indexer/languages/registry") as typeof import("@/lib/indexer/languages/registry")
  const { initializeRegistry } = require("@/lib/indexer/languages/registry") as typeof import("@/lib/indexer/languages/registry")

  await initializeRegistry()

  const allEntities: EntityDoc[] = []
  const allEdges: Array<{ _from: string; _to: string; kind: string; org_id: string; repo_id: string }> = []
  const allQuarantined: Array<{ filePath: string; reason: string }> = []

  for (const filePath of input.filePaths) {
    heartbeat(`indexing ${filePath}`)
    const fullPath = path.join(input.workspacePath, filePath)

    if (!fs.existsSync(fullPath)) continue

    const stats = fs.statSync(fullPath)
    const ext = path.extname(filePath)
    const result = await withQuarantine(
      filePath,
      stats.size,
      input.orgId,
      input.repoId,
      async () => {
        const entities: EntityDoc[] = []

        // Create file entity
        const fileId = entityHash(input.repoId, filePath, "file", filePath)
        entities.push({
          id: fileId,
          org_id: input.orgId,
          repo_id: input.repoId,
          kind: "file",
          name: filePath.split("/").pop() ?? filePath,
          file_path: filePath,
        })

        // Parse with language plugin if available
        const plugin = getPluginForExtension(ext)
        if (plugin) {
          const content = fs.readFileSync(fullPath, "utf-8")
          const parsed = await plugin.parseWithTreeSitter({
            filePath,
            content,
            orgId: input.orgId,
            repoId: input.repoId,
          })

          // Convert ParsedEntity to EntityDoc
          for (const pe of parsed.entities) {
            entities.push({
              id: pe.id,
              org_id: input.orgId,
              repo_id: input.repoId,
              kind: pe.kind,
              name: pe.name,
              file_path: pe.file_path,
              start_line: pe.start_line,
              end_line: pe.end_line,
              language: pe.language,
              signature: pe.signature,
              exported: pe.exported,
              doc: pe.doc,
              parent: pe.parent,
            })
          }

          // Convert ParsedEdge to edge docs + contains edges
          for (const pe of parsed.edges) {
            allEdges.push({
              _from: pe.from_id,
              _to: pe.to_id,
              kind: pe.kind,
              org_id: input.orgId,
              repo_id: input.repoId,
            })
          }
          for (const pe of parsed.entities) {
            allEdges.push({
              _from: fileId,
              _to: pe.id,
              kind: "contains",
              org_id: input.orgId,
              repo_id: input.repoId,
            })
          }
        }

        return entities
      }
    )

    allEntities.push(...result.entities)
    allQuarantined.push(...result.quarantined)
  }

  return { entities: allEntities, edges: allEdges, quarantined: allQuarantined }
}

export interface ApplyEntityDiffsInput {
  orgId: string
  repoId: string
  diff: EntityDiff
}

export interface ApplyEntityDiffsResult {
  entitiesAdded: number
  entitiesUpdated: number
  entitiesDeleted: number
}

/**
 * Apply entity diffs to the graph store.
 * Runs on light-llm-queue (network I/O to ArangoDB).
 */
export async function applyEntityDiffs(input: ApplyEntityDiffsInput): Promise<ApplyEntityDiffsResult> {
  const container = getContainer()
  heartbeat("applying entity diffs")

  // Delete removed entities
  if (input.diff.deleted.length > 0) {
    const deletedKeys = input.diff.deleted.map((e) => e.id)
    await container.graphStore.batchDeleteEntities(input.orgId, deletedKeys)
  }

  // Upsert added and updated entities
  const toUpsert = [...input.diff.added, ...input.diff.updated]
  if (toUpsert.length > 0) {
    await container.graphStore.bulkUpsertEntities(input.orgId, toUpsert)
  }

  return {
    entitiesAdded: input.diff.added.length,
    entitiesUpdated: input.diff.updated.length,
    entitiesDeleted: input.diff.deleted.length,
  }
}

export interface RepairEdgesInput {
  orgId: string
  repoId: string
  diff: EntityDiff
}

/**
 * Repair broken edges after entity changes.
 * Runs on light-llm-queue.
 */
export async function repairEdgesActivity(input: RepairEdgesInput): Promise<{ edgesCreated: number; edgesDeleted: number }> {
  const container = getContainer()
  heartbeat("repairing edges")
  return repairEdges(input.orgId, input.repoId, input.diff, container.graphStore)
}

export interface UpdateEmbeddingsInput {
  orgId: string
  repoId: string
  changedEntityKeys: string[]
}

/**
 * Update embeddings for changed entities.
 * Runs on light-llm-queue (network I/O).
 */
export async function updateEmbeddings(input: UpdateEmbeddingsInput): Promise<{ embeddingsUpdated: number }> {
  const container = getContainer()
  heartbeat("updating embeddings")

  if (input.changedEntityKeys.length === 0) return { embeddingsUpdated: 0 }

  // Fetch the changed entities
  const entities: EntityDoc[] = []
  for (const key of input.changedEntityKeys) {
    const entity = await container.graphStore.getEntity(input.orgId, key)
    if (entity) entities.push(entity)
  }

  if (entities.length === 0) return { embeddingsUpdated: 0 }

  // Build text content for embedding
  const texts = entities.map((e) => {
    const parts = [e.kind, e.name]
    if (e.signature) parts.push(String(e.signature))
    if (e.body) parts.push(String(e.body).slice(0, 1000))
    return parts.join(" ")
  })

  const embeddings = await container.vectorSearch.embed(texts)

  const ids = entities.map((e) => e.id)
  const metadata = entities.map((e) => ({
    orgId: e.org_id,
    repoId: e.repo_id,
    kind: e.kind,
    name: e.name,
    filePath: e.file_path,
  }))

  await container.vectorSearch.upsert(ids, embeddings, metadata)

  return { embeddingsUpdated: entities.length }
}

export interface CascadeReJustifyInput {
  orgId: string
  repoId: string
  changedEntityKeys: string[]
}

export interface CascadeReJustifyResult {
  cascadeStatus: "none" | "complete" | "skipped"
  cascadeEntities: number
}

/**
 * Cascade re-justification for changed entities and their callers.
 * Runs on light-llm-queue (LLM calls).
 */
export async function cascadeReJustify(input: CascadeReJustifyInput): Promise<CascadeReJustifyResult> {
  const container = getContainer()
  heartbeat("building cascade queue")

  if (input.changedEntityKeys.length === 0) {
    return { cascadeStatus: "none", cascadeEntities: 0 }
  }

  clearCallerCountCache()

  const cascadeResult = await buildCascadeQueue(
    input.changedEntityKeys,
    container.graphStore,
    container.vectorSearch
  )

  const allKeys = [...cascadeResult.reJustifyQueue, ...cascadeResult.cascadeQueue]
  if (allKeys.length === 0) {
    return { cascadeStatus: "skipped", cascadeEntities: 0 }
  }

  heartbeat(`re-justifying ${allKeys.length} entities`)

  // Re-justify each entity using the justification workflow
  for (const entityKey of allKeys) {
    try {
      const entity = await container.graphStore.getEntity(input.orgId, entityKey)
      if (!entity) continue

      // Get context for re-justification
      const subgraph = await container.graphStore.getSubgraph(input.orgId, entityKey, 1)
      const context = {
        entity,
        callers: subgraph.entities.filter((e) => e.id !== entityKey),
        edges: subgraph.edges,
      }

      // Use LLM for re-justification
      const prompt = `Re-evaluate the business purpose of this code entity after a change:
Name: ${entity.name}
Kind: ${entity.kind}
File: ${entity.file_path}
Connected entities: ${context.callers.map((c) => c.name).join(", ")}

Provide a brief business purpose.`

      const result = await container.llmProvider.generateObject({
        schema: {
          parse: (v: unknown) => v as { business_purpose: string; taxonomy: string; confidence: number },
        },
        prompt,
        model: LLM_MODELS.standard,
      })

      // Update justification in graph store
      const justification = {
        id: `just-${entityKey}-${Date.now()}`,
        org_id: input.orgId,
        repo_id: input.repoId,
        entity_id: entityKey,
        taxonomy: (result.object.taxonomy as "VERTICAL" | "HORIZONTAL" | "UTILITY") || "UTILITY",
        confidence: result.object.confidence || 0.5,
        business_purpose: result.object.business_purpose || "",
        domain_concepts: [],
        feature_tag: "",
        semantic_triples: [],
        compliance_tags: [],
        model_tier: "fast" as const,
        model_used: LLM_MODELS.standard,
        valid_from: new Date().toISOString(),
        valid_to: null,
        created_at: new Date().toISOString(),
      }

      await container.graphStore.bulkUpsertJustifications(input.orgId, [justification])
      heartbeat(`justified ${entityKey}`)
    } catch (error: unknown) {
      // Log and continue — don't fail the whole cascade for one entity
      console.error(`Cascade re-justify failed for ${entityKey}:`, error instanceof Error ? error.message : String(error))
    }
  }

  return { cascadeStatus: "complete", cascadeEntities: allKeys.length }
}

export interface InvalidateCachesInput {
  orgId: string
  repoId: string
}

/**
 * Invalidate caches for the affected repo.
 * Runs on light-llm-queue.
 */
export async function invalidateCaches(input: InvalidateCachesInput): Promise<void> {
  const container = getContainer()
  heartbeat("invalidating caches")

  // Invalidate common cache keys for this repo
  const patterns = [
    `mcp:stats:${input.orgId}:${input.repoId}`,
    `mcp:blueprint:${input.orgId}:${input.repoId}`,
    `mcp:health:${input.orgId}:${input.repoId}`,
    `mcp:features:${input.orgId}:${input.repoId}`,
    `graph:snapshot:${input.repoId}`,
  ]

  for (const key of patterns) {
    try {
      await container.cacheStore.invalidate(key)
    } catch {
      // Cache invalidation failure is non-fatal
    }
  }
}

export interface WriteIndexEventInput {
  orgId: string
  repoId: string
  event: IndexEventDoc
}

/**
 * Write an index event to the graph store.
 * Runs on light-llm-queue.
 */
export async function writeIndexEvent(input: WriteIndexEventInput): Promise<void> {
  const container = getContainer()
  heartbeat("writing index event")
  await container.graphStore.insertIndexEvent(input.orgId, input.event)
}
