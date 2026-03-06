import { getContainer } from "@/lib/di/container"
import { edgeHash, entityHash } from "@/lib/indexer/entity-hash"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import type { PipelineContext } from "@/lib/temporal/activities/pipeline-logs"
import { pipelineLogger } from "@/lib/temporal/activities/pipeline-logs"
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

export interface WriteToArangoInput extends PipelineContext {
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
  const plog = pipelineLogger(input, "indexing")
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

export interface FinalizeIndexingInput extends PipelineContext {
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
  const plog = pipelineLogger(input, "indexing")
  const activityStart = Date.now()
  const container = getContainer()

  await container.graphStore.bootstrapGraphSchema()

  // K-08: Shadow swap cleanup — delete entities/edges from previous index versions
  if (input.indexVersion) {
    const swapStart = Date.now()
    log.info("Cleaning up stale entities from previous index versions", { currentIndexVersion: input.indexVersion })
    try {
      await container.graphStore.deleteStaleByIndexVersion(input.orgId, input.repoId, input.indexVersion)
      const swapMs = Date.now() - swapStart
      log.info("Shadow swap cleanup complete", { currentIndexVersion: input.indexVersion, durationMs: swapMs })
      plog.log("info", "Step 4/7", `Shadow swap: removed stale entities from previous index versions (${swapMs}ms)`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn("Shadow swap cleanup failed (non-fatal)", { error: message })
      plog.log("warn", "Step 4/7", `Shadow swap cleanup failed: ${message}`)
    }
  }

  // K-09: Verify actual entity counts against ArangoDB and use them for repo status
  const verifyStart = Date.now()
  let fileCount = input.fileCount
  let functionCount = input.functionCount
  let classCount = input.classCount
  try {
    const actual = await container.graphStore.verifyEntityCounts(input.orgId, input.repoId)
    const actualTotal = actual.files + actual.functions + actual.classes
    const expectedTotal = input.fileCount + input.functionCount + input.classCount
    const verifyMs = Date.now() - verifyStart

    log.info("Entity count verification", {
      expected: { files: input.fileCount, functions: input.functionCount, classes: input.classCount, total: expectedTotal },
      actual: { ...actual, total: actualTotal },
      durationMs: verifyMs,
    })
    plog.log("info", "Step 4/7", `Entity verification: expected ${expectedTotal}, actual ${actualTotal} (files: ${actual.files}, functions: ${actual.functions}, classes: ${actual.classes}) (${verifyMs}ms)`)

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
  const totalMs = Date.now() - activityStart
  plog.log("info", "Step 4/7", `Index finalized — ${fileCount} files, ${functionCount} functions, ${classCount} classes (${totalMs}ms)`)
  log.info("Index finalized", { fileCount, functionCount, classCount, durationMs: totalMs })
}

export async function updateRepoError(repoId: string, errorMessage: string): Promise<void> {
  logger.error("Indexing failed", undefined, { service: "indexing", repoId, errorMessage })
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(repoId, { status: "error", errorMessage })
}

export async function wipeRepoGraphData(input: { orgId: string; repoId: string }): Promise<void> {
  const log = logger.child({ service: "indexing-light", organizationId: input.orgId, repoId: input.repoId })
  log.info("Wiping all repo data for clean reindex (graph, cache, embeddings, storage, filesystem)")
  const container = getContainer()
  const { orgId, repoId } = input
  const start = Date.now()

  // 1. ArangoDB graph data
  try {
    await container.graphStore.bootstrapGraphSchema()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn("Bootstrap before wipe failed (non-fatal, proceeding with wipe)", { error: msg })
  }
  const graphStart = Date.now()
  await container.graphStore.deleteRepoData(orgId, repoId)
  const graphMs = Date.now() - graphStart
  log.info("Graph data wiped", { durationMs: graphMs })

  // 2. Redis cache keys (entity profiles, topo levels, pipeline logs)
  const cacheStart = Date.now()
  let cacheKeysDeleted = 0
  const fixedKeys = [
    `topo:${orgId}:${repoId}:meta`,
    `repo-retry:${orgId}:${repoId}`,
    `repo-resume:${orgId}:${repoId}`,
    `graph-sync:${orgId}:${repoId}`,
  ]
  for (const key of fixedKeys) {
    try {
      await container.cacheStore.invalidate(key)
      cacheKeysDeleted++
    } catch {
      // Non-fatal
    }
  }
  if (container.cacheStore.invalidateByPrefix) {
    const prefixes = [
      `profile:${orgId}:${repoId}:`,
      `topo:${orgId}:${repoId}:`,
      `justify-changed:${orgId}:${repoId}:`,
    ]
    for (const prefix of prefixes) {
      try {
        const count = await container.cacheStore.invalidateByPrefix(prefix)
        cacheKeysDeleted += count
      } catch {
        // Non-fatal
      }
    }
  }
  try {
    const { getRedis } = require("@/lib/queue/redis") as typeof import("@/lib/queue/redis")
    const redis = getRedis()
    const logPrefix = `unerr:pipeline-logs:${repoId}`
    let cursor = "0"
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${logPrefix}*`, "COUNT", 100)
      cursor = nextCursor
      if (keys.length > 0) {
        await redis.del(...keys)
        cacheKeysDeleted += keys.length
      }
    } while (cursor !== "0")
  } catch {
    // Non-fatal — pipeline logs will expire via TTL
  }
  const cacheMs = Date.now() - cacheStart
  log.info("Cache keys invalidated", { cacheKeysDeleted, durationMs: cacheMs })

  // 3. pgvector embeddings (entity + justification)
  const embedStart = Date.now()
  let embeddingsDeleted = 0
  try {
    if (container.vectorSearch.deleteAllEmbeddings) {
      embeddingsDeleted += await container.vectorSearch.deleteAllEmbeddings(repoId)
    }
    if (container.vectorSearch.deleteJustificationEmbeddings) {
      embeddingsDeleted += await container.vectorSearch.deleteJustificationEmbeddings(repoId)
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn("Embedding cleanup failed (non-fatal)", { error: msg })
  }
  const embedMs = Date.now() - embedStart
  log.info("Embeddings deleted", { embeddingsDeleted, durationMs: embedMs })

  // 4. Supabase Storage (graph snapshots + pipeline log archives)
  const storageStart = Date.now()
  let storageFilesDeleted = 0
  try {
    const { supabase } = require("@/lib/db") as typeof import("@/lib/db")

    // Graph snapshot file
    const snapshotBucket = process.env.GRAPH_SNAPSHOT_BUCKET ?? "graph-snapshots"
    const snapshotPath = `${orgId}/${repoId}.msgpack.gz`
    try {
      const { error } = await supabase.storage.from(snapshotBucket).remove([snapshotPath])
      if (!error) storageFilesDeleted++
    } catch {
      // Non-fatal
    }

    // Pipeline log archives
    try {
      const logBucket = "pipeline-logs"
      const logPrefix = `${orgId}/${repoId}`
      const { data: logFiles } = await supabase.storage.from(logBucket).list(logPrefix, { limit: 1000 })
      if (logFiles && logFiles.length > 0) {
        const allPaths: string[] = []
        for (const file of logFiles) {
          if (file.id) {
            allPaths.push(`${logPrefix}/${file.name}`)
          } else {
            const { data: subFiles } = await supabase.storage.from(logBucket).list(`${logPrefix}/${file.name}`, { limit: 1000 })
            if (subFiles) {
              for (const sf of subFiles) {
                allPaths.push(`${logPrefix}/${file.name}/${sf.name}`)
              }
            }
          }
        }
        if (allPaths.length > 0) {
          const { error } = await supabase.storage.from(logBucket).remove(allPaths)
          if (!error) storageFilesDeleted += allPaths.length
        }
      }
    } catch {
      // Non-fatal
    }
  } catch {
    log.warn("Supabase Storage cleanup skipped (non-fatal)")
  }
  const storageMs = Date.now() - storageStart
  log.info("Storage files deleted", { storageFilesDeleted, durationMs: storageMs })

  // 5. Filesystem — remove clone dir so prepareRepoIntelligenceSpace starts fresh
  const fsStart = Date.now()
  try {
    const { existsSync, rmSync } = require("node:fs") as typeof import("node:fs")
    const indexDir = `/data/repo-indices/${orgId}/${repoId}`
    if (existsSync(indexDir)) {
      rmSync(indexDir, { recursive: true, force: true })
      log.info("Filesystem clone dir removed", { path: indexDir })
    }
  } catch {
    // Non-fatal
  }
  const fsMs = Date.now() - fsStart

  const totalMs = Date.now() - start
  log.info("All repo data wiped for clean reindex", {
    timing: { graphMs, cacheMs, embedMs, storageMs, fsMs, totalMs },
    cacheKeysDeleted,
    embeddingsDeleted,
    storageFilesDeleted,
  })
}

export async function deleteRepoData(input: DeleteRepoDataInput): Promise<void> {
  const log = logger.child({ service: "indexing-light", organizationId: input.orgId, repoId: input.repoId })
  const start = Date.now()
  log.info("━━━ DELETING ALL REPO DATA ━━━")
  const container = getContainer()
  const { orgId, repoId } = input

  // 1. Delete all ArangoDB graph data (22 doc + 8 edge collections)
  const graphStart = Date.now()
  await container.graphStore.deleteRepoData(orgId, repoId)
  const graphMs = Date.now() - graphStart
  log.info("Graph data deleted", { graphMs })

  // 2. Invalidate ALL known Redis cache keys for this repo.
  // Uses invalidateByPrefix for key families (entity profiles, topo levels, pipeline logs, etc.)
  const cacheStart = Date.now()
  let cacheKeysDeleted = 0

  // 2a. Known individual cache keys
  const fixedKeys = [
    `topo:${orgId}:${repoId}:meta`,
    `repo-retry:${orgId}:${repoId}`,
    `repo-resume:${orgId}:${repoId}`,
    `graph-sync:${orgId}:${repoId}`,
  ]
  for (const key of fixedKeys) {
    try {
      await container.cacheStore.invalidate(key)
      cacheKeysDeleted++
    } catch {
      // Cache invalidation failure is non-fatal
    }
  }

  // 2b. Prefix-based cleanup for key families (entity profiles, topo levels, changed IDs, pipeline logs)
  if (container.cacheStore.invalidateByPrefix) {
    const prefixes = [
      `profile:${orgId}:${repoId}:`,           // Entity profile cache (L-14)
      `topo:${orgId}:${repoId}:`,              // Topological level data
      `justify-changed:${orgId}:${repoId}:`,   // Changed entity IDs per level
    ]
    for (const prefix of prefixes) {
      try {
        const count = await container.cacheStore.invalidateByPrefix(prefix)
        cacheKeysDeleted += count
      } catch {
        // Non-fatal
      }
    }
  }

  // 2c. Pipeline log Redis keys (use raw Redis since they have a different prefix pattern)
  try {
    const { getRedis } = require("@/lib/queue/redis") as typeof import("@/lib/queue/redis")
    const redis = getRedis()
    const logPrefix = `unerr:pipeline-logs:${repoId}`
    let cursor = "0"
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${logPrefix}*`, "COUNT", 100)
      cursor = nextCursor
      if (keys.length > 0) {
        await redis.del(...keys)
        cacheKeysDeleted += keys.length
      }
    } while (cursor !== "0")
  } catch {
    // Non-fatal — pipeline logs will expire via TTL
  }

  const cacheMs = Date.now() - cacheStart
  log.info("Cache keys invalidated", { cacheKeysDeleted, cacheMs })

  // 3. Delete files from Supabase Storage (graph snapshots + pipeline log archives)
  const storageStart = Date.now()
  let storageFilesDeleted = 0
  try {
    const { supabase } = require("@/lib/db") as typeof import("@/lib/db")

    // 3a. Graph snapshot file
    const snapshotBucket = process.env.GRAPH_SNAPSHOT_BUCKET ?? "graph-snapshots"
    const snapshotPath = `${orgId}/${repoId}.msgpack.gz`
    try {
      const { error } = await supabase.storage.from(snapshotBucket).remove([snapshotPath])
      if (!error) storageFilesDeleted++
    } catch {
      // Non-fatal — file may not exist
    }

    // 3b. Pipeline log archives (list all files under orgId/repoId/ prefix)
    try {
      const logBucket = "pipeline-logs"
      const logPrefix = `${orgId}/${repoId}`
      const { data: logFiles } = await supabase.storage.from(logBucket).list(logPrefix, { limit: 1000 })
      if (logFiles && logFiles.length > 0) {
        // Files may be nested (with runId subdirectories), so list recursively
        const allPaths: string[] = []
        for (const file of logFiles) {
          if (file.id) {
            // It's a file
            allPaths.push(`${logPrefix}/${file.name}`)
          } else {
            // It's a folder (runId) — list its contents
            const { data: subFiles } = await supabase.storage.from(logBucket).list(`${logPrefix}/${file.name}`, { limit: 1000 })
            if (subFiles) {
              for (const sf of subFiles) {
                allPaths.push(`${logPrefix}/${file.name}/${sf.name}`)
              }
            }
          }
        }
        if (allPaths.length > 0) {
          const { error } = await supabase.storage.from(logBucket).remove(allPaths)
          if (!error) storageFilesDeleted += allPaths.length
        }
      }
    } catch {
      // Non-fatal — log archives are not critical
    }
  } catch {
    log.warn("Supabase Storage cleanup skipped (non-fatal)")
  }
  const storageMs = Date.now() - storageStart
  log.info("Storage files deleted", { storageFilesDeleted, storageMs })

  // 4. Clean up workspace filesystem (cloned repos + index artifacts)
  const fsStart = Date.now()
  let fsCleaned = 0
  const { existsSync, rmSync } = require("node:fs") as typeof import("node:fs")
  const { join } = require("node:path") as typeof import("node:path")

  const fsPaths = [
    join("/data/repo-indices", orgId, repoId),
  ]
  for (const fsPath of fsPaths) {
    try {
      if (existsSync(fsPath)) {
        rmSync(fsPath, { recursive: true, force: true })
        fsCleaned++
        log.info("Filesystem directory removed", { path: fsPath })
      }
    } catch {
      // Non-fatal
    }
  }
  const fsMs = Date.now() - fsStart

  // 5. Delete the repo record — CASCADE FKs automatically remove:
  //    pipeline_runs, api_keys, entity_embeddings, justification_embeddings,
  //    rule_embeddings, ledger_snapshots, workspaces, graph_snapshot_meta
  const pgStart = Date.now()
  await container.relationalStore.deleteRepo(input.repoId)
  const pgMs = Date.now() - pgStart

  const totalMs = Date.now() - start
  log.info("━━━ REPO DELETE COMPLETE ━━━", {
    timing: { graphMs, cacheMs, storageMs, fsMs, pgMs, totalMs },
    cacheKeysDeleted,
    storageFilesDeleted,
    fsCleaned,
  })
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
