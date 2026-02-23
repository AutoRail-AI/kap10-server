/**
 * Phase 5: Temporal activities for incremental indexing.
 * Split between heavy-compute-queue (CPU-bound) and light-llm-queue (network-bound).
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { writeEntitiesToGraph } from "@/lib/temporal/activities/graph-writer"
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
  entityIds: string[]
  entityCount: number
  edgeCount: number
  quarantined: Array<{ filePath: string; reason: string }>
}

/**
 * Re-index a batch of changed files: extract entities/edges and write
 * directly to ArangoDB. Returns only entity IDs and counts — no large
 * payloads cross the Temporal boundary.
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

        const fileId = entityHash(input.repoId, filePath, "file", filePath)
        entities.push({
          id: fileId,
          org_id: input.orgId,
          repo_id: input.repoId,
          kind: "file",
          name: filePath.split("/").pop() ?? filePath,
          file_path: filePath,
        })

        const plugin = getPluginForExtension(ext)
        if (plugin) {
          const content = fs.readFileSync(fullPath, "utf-8")
          const parsed = await plugin.parseWithTreeSitter({
            filePath,
            content,
            orgId: input.orgId,
            repoId: input.repoId,
          })

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

  // Write directly to ArangoDB — large payloads stay in the worker
  const container = getContainer()
  const writeResult = await writeEntitiesToGraph(
    container,
    input.orgId,
    input.repoId,
    allEntities,
    allEdges as import("@/lib/ports/types").EdgeDoc[],
  )

  return {
    entityIds: allEntities.map((e) => e.id),
    entityCount: writeResult.entitiesWritten,
    edgeCount: writeResult.edgesWritten,
    quarantined: allQuarantined,
  }
}

export interface ApplyEntityDiffsInput {
  orgId: string
  repoId: string
  addedEntityIds: string[]
  removedFilePaths: string[]
}

export interface ApplyEntityDiffsResult {
  entitiesAdded: number
  entitiesUpdated: number
  entitiesDeleted: number
}

/**
 * Finalize entity diffs: delete entities for removed files.
 * Added/updated entities are already written by reIndexBatch.
 * Only lightweight IDs/paths cross the Temporal boundary.
 */
export async function applyEntityDiffs(input: ApplyEntityDiffsInput): Promise<ApplyEntityDiffsResult> {
  const container = getContainer()
  heartbeat("applying entity diffs")

  let deletedCount = 0
  if (input.removedFilePaths.length > 0) {
    for (const filePath of input.removedFilePaths) {
      const fileEntities = await container.graphStore.getEntitiesByFile(
        input.orgId,
        input.repoId,
        filePath,
      )
      if (fileEntities.length > 0) {
        const keys = fileEntities.map((e) => e.id)
        await container.graphStore.batchDeleteEntities(input.orgId, keys)
        deletedCount += keys.length
      }
    }
  }

  return {
    entitiesAdded: input.addedEntityIds.length,
    entitiesUpdated: 0,
    entitiesDeleted: deletedCount,
  }
}

export interface RepairEdgesInput {
  orgId: string
  repoId: string
  changedEntityIds: string[]
  removedFilePaths: string[]
}

/**
 * Repair broken edges after entity changes.
 * Fetches full entity data from ArangoDB internally — only IDs cross Temporal.
 */
export async function repairEdgesActivity(input: RepairEdgesInput): Promise<{ edgesCreated: number; edgesDeleted: number }> {
  const container = getContainer()
  heartbeat("repairing edges")

  // Build a lightweight diff from IDs by fetching entities from ArangoDB
  const added: EntityDoc[] = []
  for (const id of input.changedEntityIds) {
    const entity = await container.graphStore.getEntity(input.orgId, id)
    if (entity) added.push(entity)
  }

  const deleted: EntityDoc[] = []
  for (const filePath of input.removedFilePaths) {
    const entities = await container.graphStore.getEntitiesByFile(input.orgId, input.repoId, filePath)
    deleted.push(...entities)
  }

  const diff: EntityDiff = { added, updated: [], deleted }
  return repairEdges(input.orgId, input.repoId, diff, container.graphStore)
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
