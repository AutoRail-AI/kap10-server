/**
 * Phase 5: Edge repair after incremental entity changes.
 * Fixes broken edges when entities are added, updated, or deleted.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"
import type { EntityDiff } from "@/lib/ports/types"

export interface EdgeRepairResult {
  edgesCreated: number
  edgesDeleted: number
}

/**
 * Repair edges after entity diff is applied.
 *
 * - Deleted entities: remove all edges referencing them
 * - Added entities: no automatic edge creation (edges come from re-indexing)
 * - Updated entities: edges stay (same key), but check for broken references
 */
export async function repairEdges(
  orgId: string,
  repoId: string,
  entityDiff: EntityDiff,
  graphStore: IGraphStore
): Promise<EdgeRepairResult> {
  let edgesDeleted = 0
  const edgesCreated = 0

  // Step 1: Delete edges for removed entities
  const deletedKeys = entityDiff.deleted.map((e) => e.id)
  if (deletedKeys.length > 0) {
    const brokenEdges = await graphStore.findBrokenEdges(orgId, repoId, deletedKeys)
    edgesDeleted = brokenEdges.length
    await graphStore.batchDeleteEdgesByEntity(orgId, deletedKeys)
  }

  // Step 2: For updated entities, check if any edges reference deleted entities.
  // An entity rename keeps the same key, but if one endpoint of an edge was
  // deleted in the same diff, the edge is now broken and must be removed.
  const updatedKeys = entityDiff.updated.map((e) => e.id)
  if (updatedKeys.length > 0 && deletedKeys.length > 0) {
    const updatedEdges = await graphStore.getEdgesForEntities(orgId, updatedKeys)

    // Collect keys of entities whose edges now dangle (point to a deleted entity)
    const brokenEndpoints = new Set<string>()
    for (const edge of updatedEdges) {
      const fromKey = edge._from.split("/").pop()
      const toKey = edge._to.split("/").pop()
      if (fromKey && deletedKeys.includes(fromKey)) brokenEndpoints.add(fromKey)
      if (toKey && deletedKeys.includes(toKey)) brokenEndpoints.add(toKey)
    }

    // Actually delete the broken edges (Step 1 already handles edges where BOTH
    // endpoints are deleted; this handles the case where only one endpoint is deleted
    // but the edge was also attached to an updated entity)
    if (brokenEndpoints.size > 0) {
      const keysToClean = Array.from(brokenEndpoints)
      await graphStore.batchDeleteEdgesByEntity(orgId, keysToClean)
      edgesDeleted += brokenEndpoints.size
    }
  }

  return { edgesCreated, edgesDeleted }
}
