/**
 * Shared helper for writing entities/edges to ArangoDB.
 * Used by both heavy-compute and light-llm activities to avoid
 * serializing large payloads through Temporal's data converter.
 */

import type { Container } from "@/lib/di/container"
import { edgeHash, entityHash } from "@/lib/indexer/entity-hash"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

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

export interface WriteResult {
  entitiesWritten: number
  edgesWritten: number
  fileCount: number
  functionCount: number
  classCount: number
}

/**
 * Write entities and edges to ArangoDB with deterministic hashing,
 * file entity generation, deduplication, and optional index versioning.
 * This is the core write logic extracted from the old writeToArango activity
 * so it can be called from any worker queue.
 */
export async function writeEntitiesToGraph(
  container: Container,
  orgId: string,
  repoId: string,
  rawEntities: EntityDoc[],
  rawEdges: EdgeDoc[],
  indexVersion?: string,
): Promise<WriteResult> {
  await container.graphStore.bootstrapGraphSchema()

  const entities = applyEntityHashing(rawEntities, repoId)
  const edges = applyEdgeHashing(rawEdges)

  const { fileEntities, containsEdges } = generateFileEntitiesAndEdges(
    entities,
    orgId,
    repoId,
  )

  let allEntities = deduplicateEntities([...entities, ...fileEntities])
  let allEdges = deduplicateEdges([...edges, ...containsEdges])

  if (indexVersion) {
    allEntities = allEntities.map((e) => ({ ...e, index_version: indexVersion }))
    allEdges = allEdges.map((e) => ({ ...e, index_version: indexVersion }))
  }

  if (allEntities.length > 0) {
    await container.graphStore.bulkUpsertEntities(orgId, allEntities)
  }
  if (allEdges.length > 0) {
    await container.graphStore.bulkUpsertEdges(orgId, allEdges)
  }

  return {
    entitiesWritten: allEntities.length,
    edgesWritten: allEdges.length,
    fileCount: new Set(allEntities.map((e) => e.file_path).filter(Boolean)).size,
    functionCount: allEntities.filter((e) => e.kind === "function").length,
    classCount: allEntities.filter((e) => e.kind === "class").length,
  }
}

function applyEntityHashing(entities: EntityDoc[], repoId: string): EntityDoc[] {
  return entities.map((e) => ({
    ...e,
    id: e.id || entityHash(repoId, e.file_path, e.kind, e.name, e.signature as string | undefined),
  }))
}

function applyEdgeHashing(edges: EdgeDoc[]): EdgeDoc[] {
  return edges.map((e) => ({
    ...e,
    _key: edgeHash(e._from, e._to, e.kind),
  }))
}

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

function deduplicateEntities(entities: EntityDoc[]): EntityDoc[] {
  const seen = new Set<string>()
  return entities.filter((e) => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })
}

function deduplicateEdges(edges: EdgeDoc[]): EdgeDoc[] {
  const seen = new Set<string>()
  return edges.filter((e) => {
    const key = `${e._from}:${e._to}:${e.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
