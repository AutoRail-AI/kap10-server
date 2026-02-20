import { getContainer } from "@/lib/di/container"
import { edgeHash, entityHash } from "@/lib/indexer/entity-hash"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

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
}

export interface WriteToArangoResult {
  entitiesWritten: number
  edgesWritten: number
  fileCount: number
  functionCount: number
  classCount: number
}

export async function writeToArango(input: WriteToArangoInput): Promise<WriteToArangoResult> {
  const container = getContainer()

  // Apply deterministic hashing to entities and edges
  const entities = applyEntityHashing(input.entities, input.repoId)
  const edges = applyEdgeHashing(input.edges)

  // Ensure all entities have file entities and contains edges
  const { fileEntities, containsEdges } = generateFileEntitiesAndEdges(
    entities,
    input.orgId,
    input.repoId,
  )

  const allEntities = deduplicateEntities([...entities, ...fileEntities])
  const allEdges = deduplicateEdges([...edges, ...containsEdges])

  if (allEntities.length > 0) {
    await container.graphStore.bulkUpsertEntities(input.orgId, allEntities)
  }
  if (allEdges.length > 0) {
    await container.graphStore.bulkUpsertEdges(input.orgId, allEdges)
  }
  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "ready",
    progress: 100,
    fileCount: input.fileCount,
    functionCount: input.functionCount,
    classCount: input.classCount,
    errorMessage: null,
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

export async function updateRepoError(repoId: string, errorMessage: string): Promise<void> {
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(repoId, { status: "error", errorMessage })
}

export async function deleteRepoData(input: DeleteRepoDataInput): Promise<void> {
  const container = getContainer()
  await container.graphStore.deleteRepoData(input.orgId, input.repoId)
  await container.relationalStore.deleteRepo(input.repoId)
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
