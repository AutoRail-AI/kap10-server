/**
 * Phase 5: Edge repair after incremental entity changes.
 * Fixes broken edges when entities are added, updated, or deleted.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"
import type { EdgeDoc, EntityDiff } from "@/lib/ports/types"

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
  let edgesCreated = 0

  // Step 1: Delete edges for removed entities
  const deletedKeys = entityDiff.deleted.map((e) => e.id)
  if (deletedKeys.length > 0) {
    const brokenEdges = await graphStore.findBrokenEdges(orgId, repoId, deletedKeys)
    edgesDeleted = brokenEdges.length
    await graphStore.batchDeleteEdgesByEntity(orgId, deletedKeys)
  }

  // Step 2: For updated entities, check if any edges became broken
  // (e.g., entity moved to different file but kept same key)
  const updatedKeys = entityDiff.updated.map((e) => e.id)
  if (updatedKeys.length > 0) {
    // Edges are keyed by _from/_to which use entity keys,
    // so they survive updates. No action needed unless the kind changed.
    const updatedEdges = await graphStore.getEdgesForEntities(orgId, updatedKeys)

    // Verify edges still point to valid collections
    for (const edge of updatedEdges) {
      const fromKey = edge._from.split("/").pop()
      const toKey = edge._to.split("/").pop()

      // Check if referenced entities still exist
      if (fromKey && deletedKeys.includes(fromKey)) {
        edgesDeleted++
      }
      if (toKey && deletedKeys.includes(toKey)) {
        edgesDeleted++
      }
    }
  }

  return { edgesCreated, edgesDeleted }
}
