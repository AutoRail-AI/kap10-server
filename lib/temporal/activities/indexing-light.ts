import { getContainer } from "@/lib/di/container"
import { edgeHash, entityHash } from "@/lib/indexer/entity-hash"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import { createPipelineLogger } from "@/lib/temporal/activities/pipeline-logs"
import { logger } from "@/lib/utils/logger"

/** Map singular entity kind → plural ArangoDB collection name. */
const KIND_TO_COLLECTION: Record<string, string> = {
  file: "files",
  function: "functions",
  method: "functions",
  class: "classes",
  interface: "interfaces",
  variable: "variables",
  type: "variables",
  enum: "variables",
  struct: "classes",
  module: "files",
  namespace: "files",
  decorator: "functions",
  directory: "files",
}

export interface WriteToArangoInput {
  orgId: string
  repoId: string
  entities: EntityDoc[]
  edges: EdgeDoc[]
  fileCount: number
  functionCount: number
  classCount: number
  indexVersion?: string
}

export interface WriteToArangoResult {
  entitiesWritten: number
  edgesWritten: number
  fileCount: number
  functionCount: number
  classCount: number
}

export async function writeToArango(input: WriteToArangoInput): Promise<WriteToArangoResult> {
  const log = logger.child({ service: "indexing-light", organizationId: input.orgId, repoId: input.repoId })
  const plog = createPipelineLogger(input.repoId, "indexing")
  log.info("Writing to ArangoDB", { entityCount: input.entities.length, edgeCount: input.edges.length })
  plog.log("info", "Step 4/7", `Writing ${input.entities.length} entities and ${input.edges.length} edges to graph store...`)
  const container = getContainer()

  // Ensure all ArangoDB collections exist (idempotent — covers orgs created before new collections were added)
  await container.graphStore.bootstrapGraphSchema()

  // Apply deterministic hashing to entities and edges
  const entities = applyEntityHashing(input.entities, input.repoId)
  const edges = applyEdgeHashing(input.edges)

  // Ensure all entities have file entities and contains edges
  const { fileEntities, containsEdges } = generateFileEntitiesAndEdges(
    entities,
    input.orgId,
    input.repoId,
  )

  let allEntities = deduplicateEntities([...entities, ...fileEntities])
  let allEdges = deduplicateEdges([...edges, ...containsEdges])

  // Stamp index_version for shadow reindexing
  if (input.indexVersion) {
    allEntities = allEntities.map((e) => ({ ...e, index_version: input.indexVersion }))
    allEdges = allEdges.map((e) => ({ ...e, index_version: input.indexVersion }))
  }

  if (allEntities.length > 0) {
    await container.graphStore.bulkUpsertEntities(input.orgId, allEntities)
  }
  if (allEdges.length > 0) {
    await container.graphStore.bulkUpsertEdges(input.orgId, allEdges)
  }

  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "indexing",
    progress: 90,
    fileCount: input.fileCount,
    functionCount: input.functionCount,
    classCount: input.classCount,
    errorMessage: null,
  })
  plog.log("info", "Step 4/7", `Graph store write complete — ${allEntities.length} entities, ${allEdges.length} edges stored`)
  log.info("ArangoDB write complete", {
    entitiesWritten: allEntities.length,
    edgesWritten: allEdges.length,
    fileCount: input.fileCount,
    functionCount: input.functionCount,
    classCount: input.classCount,
  })
  return {
    entitiesWritten: allEntities.length,
    edgesWritten: allEdges.length,
    fileCount: input.fileCount,
    functionCount: input.functionCount,
    classCount: input.classCount,
  }
}

export interface DeleteRepoDataInput {
  orgId: string
  repoId: string
}

export interface FinalizeIndexingInput {
  orgId: string
  repoId: string
  fileCount: number
  functionCount: number
  classCount: number
  indexVersion?: string
}

/**
 * Lightweight finalize step: bootstrap schema, handle shadow reindex cleanup,
 * and update repo status. Called after heavy activities have already written
 * entities/edges directly to ArangoDB.
 */
export async function finalizeIndexing(input: FinalizeIndexingInput): Promise<void> {
  const log = logger.child({ service: "indexing-light", organizationId: input.orgId, repoId: input.repoId })
  const plog = createPipelineLogger(input.repoId, "indexing")
  const container = getContainer()

  await container.graphStore.bootstrapGraphSchema()

  // K-08: Shadow swap cleanup — delete entities/edges from previous index versions
  if (input.indexVersion) {
    log.info("Cleaning up stale entities from previous index versions", { currentIndexVersion: input.indexVersion })
    try {
      await container.graphStore.deleteStaleByIndexVersion(input.orgId, input.repoId, input.indexVersion)
      log.info("Shadow swap cleanup complete", { currentIndexVersion: input.indexVersion })
      plog.log("info", "Step 4/7", `Shadow swap: removed stale entities from previous index versions`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn("Shadow swap cleanup failed (non-fatal)", { error: message })
      plog.log("warn", "Step 4/7", `Shadow swap cleanup failed: ${message}`)
    }
  }

  // K-09: Verify actual entity counts against ArangoDB and use them for repo status
  let fileCount = input.fileCount
  let functionCount = input.functionCount
  let classCount = input.classCount
  try {
    const actual = await container.graphStore.verifyEntityCounts(input.orgId, input.repoId)
    const actualTotal = actual.files + actual.functions + actual.classes
    const expectedTotal = input.fileCount + input.functionCount + input.classCount

    // Log divergence if >10%
    if (expectedTotal > 0) {
      const divergence = Math.abs(actualTotal - expectedTotal) / expectedTotal
      if (divergence > 0.1) {
        log.warn("Entity count divergence detected", {
          expected: { files: input.fileCount, functions: input.functionCount, classes: input.classCount },
          actual,
          divergencePercent: Math.round(divergence * 100),
        })
        plog.log("warn", "Step 4/7", `Entity count divergence: expected ${expectedTotal} total, got ${actualTotal} (${Math.round(divergence * 100)}% off)`)
      }
    }

    // Always use actual ArangoDB counts
    fileCount = actual.files
    functionCount = actual.functions
    classCount = actual.classes
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Entity count verification failed (using pipeline counts)", { error: message })
  }

  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "indexing",
    progress: 90,
    fileCount,
    functionCount,
    classCount,
    errorMessage: null,
  })
  plog.log("info", "Step 4/7", `Index finalized — ${fileCount} files, ${functionCount} functions, ${classCount} classes`)
  log.info("Index finalized", { fileCount, functionCount, classCount })
}

export async function updateRepoError(repoId: string, errorMessage: string): Promise<void> {
  logger.error("Indexing failed", undefined, { service: "indexing", repoId, errorMessage })
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(repoId, { status: "error", errorMessage })
}

export async function wipeRepoGraphData(input: { orgId: string; repoId: string }): Promise<void> {
  const log = logger.child({ service: "indexing-light", organizationId: input.orgId, repoId: input.repoId })
  log.info("Wiping existing graph data for clean reindex")
  const container = getContainer()
  const start = Date.now()
  await container.graphStore.deleteRepoData(input.orgId, input.repoId)
  log.info("Graph data wiped", { durationMs: Date.now() - start })
}

export async function deleteRepoData(input: DeleteRepoDataInput): Promise<void> {
  const log = logger.child({ service: "indexing-light", organizationId: input.orgId, repoId: input.repoId })
  const start = Date.now()
  log.info("Deleting all repo data (graph + relational + cache)")
  const container = getContainer()

  // 1. Delete all ArangoDB graph data (entities, edges, metadata collections)
  await container.graphStore.deleteRepoData(input.orgId, input.repoId)
  log.info("Graph data deleted")

  // 2. Invalidate known cache keys for this repo
  const cacheKeys = [
    `topo:${input.orgId}:${input.repoId}:meta`,
    `repo-retry:${input.orgId}:${input.repoId}`,
    `repo-resume:${input.orgId}:${input.repoId}`,
  ]
  for (const key of cacheKeys) {
    try {
      await container.cacheStore.invalidate(key)
    } catch {
      // Cache invalidation failure is non-fatal
    }
  }
  log.info("Cache keys invalidated")

  // 3. Delete the repo record — CASCADE FKs automatically remove:
  //    pipeline_runs, api_keys, entity_embeddings, justification_embeddings,
  //    rule_embeddings, ledger_snapshots, workspaces, graph_snapshot_meta
  await container.relationalStore.deleteRepo(input.repoId)
  log.info("Relational repo record and all cascaded data deleted", { durationMs: Date.now() - start })
}

/**
 * Apply deterministic hashing to entity IDs.
 * Ensures entities already hashed (from the indexer pipeline) keep their IDs,
 * while any legacy entities get stable hashes.
 */
function applyEntityHashing(entities: EntityDoc[], repoId: string): EntityDoc[] {
  return entities.map((e) => ({
    ...e,
    id: e.id || entityHash(repoId, e.file_path, e.kind, e.name, e.signature as string | undefined),
  }))
}

/**
 * Apply deterministic hashing to edge keys.
 */
function applyEdgeHashing(edges: EdgeDoc[]): EdgeDoc[] {
  return edges.map((e) => ({
    ...e,
    _key: edgeHash(e._from, e._to, e.kind),
  }))
}

/**
 * Generate file entities for every unique file_path in the entity list,
 * and contains edges from files to their entities.
 */
function generateFileEntitiesAndEdges(
  entities: EntityDoc[],
  orgId: string,
  repoId: string,
): { fileEntities: EntityDoc[]; containsEdges: EdgeDoc[] } {
  const fileEntities: EntityDoc[] = []
  const containsEdges: EdgeDoc[] = []
  const seenFiles = new Set<string>()

  for (const entity of entities) {
    if (!entity.file_path) continue

    // Create file entity if not seen
    if (!seenFiles.has(entity.file_path)) {
      seenFiles.add(entity.file_path)
      const fileId = entityHash(repoId, entity.file_path, "file", entity.file_path)
      fileEntities.push({
        id: fileId,
        org_id: orgId,
        repo_id: repoId,
        kind: "file",
        name: entity.file_path.split("/").pop() ?? entity.file_path,
        file_path: entity.file_path,
      })
    }

    // Create contains edge: file → entity (skip file entities themselves)
    if (entity.kind !== "file") {
      const fileId = entityHash(repoId, entity.file_path, "file", entity.file_path)
      const entityCollection = KIND_TO_COLLECTION[entity.kind] ?? "functions"
      containsEdges.push({
        _from: `files/${fileId}`,
        _to: `${entityCollection}/${entity.id}`,
        org_id: orgId,
        repo_id: repoId,
        kind: "contains",
      })
    }
  }

  return { fileEntities, containsEdges }
}

/** Deduplicate entities by id. */
function deduplicateEntities(entities: EntityDoc[]): EntityDoc[] {
  const seen = new Set<string>()
  return entities.filter((e) => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })
}

/** Deduplicate edges by _from + _to + kind. */
function deduplicateEdges(edges: EdgeDoc[]): EdgeDoc[] {
  const seen = new Set<string>()
  return edges.filter((e) => {
    const key = `${e._from}:${e._to}:${e.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
