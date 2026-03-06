/**
 * incremental-merge — Phase 13 D-05: Delta computation between entity sets.
 *
 * Compares a "base" set of entities (e.g., primary branch) against a "branch"
 * set to produce an EntityDelta: added, modified, and deleted entities/edges.
 *
 * The delta is the input to `applyBranchDelta()` on the graph store, which
 * writes branch-scoped entities and tombstones atomically.
 *
 * Identity key: (file_path, kind, name) — the same triple used by entityHash.
 * We compare by entity ID (deterministic hash) rather than content, because
 * entityHash already captures the structural identity. If an entity exists in
 * both sets with the same ID, we check whether it actually changed by comparing
 * a shallow content hash (signature + start_line + end_line).
 */

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import type { EntityDelta } from "@/lib/ports/types"

/**
 * Compute the delta between base (primary) and branch entity sets.
 *
 * - added: entities in `branchEntities` whose ID is not in `baseEntities`
 * - modified: entities in both sets whose content differs
 * - deletedKeys: entity IDs in `baseEntities` not present in `branchEntities`
 *
 * Edge delta follows the same logic keyed by `_from:_to:kind`.
 */
export function computeEntityDelta(
  baseEntities: EntityDoc[],
  branchEntities: EntityDoc[],
  baseEdges: EdgeDoc[] = [],
  branchEdges: EdgeDoc[] = [],
): EntityDelta {
  // --- Entity delta ---
  const baseMap = new Map<string, EntityDoc>()
  for (const e of baseEntities) {
    baseMap.set(e.id, e)
  }

  const added: EntityDoc[] = []
  const modified: EntityDoc[] = []
  const seenBranchIds = new Set<string>()

  for (const e of branchEntities) {
    seenBranchIds.add(e.id)
    const base = baseMap.get(e.id)
    if (!base) {
      added.push(e)
    } else if (entityContentChanged(base, e)) {
      modified.push(e)
    }
    // If unchanged, skip — primary entity is sufficient
  }

  // Entities in base but not in branch → need tombstones
  const deletedKeys: string[] = []
  for (const id of baseMap.keys()) {
    if (!seenBranchIds.has(id)) {
      deletedKeys.push(id)
    }
  }

  // --- Edge delta ---
  const edgeKey = (e: EdgeDoc) => `${e._from}:${e._to}:${e.kind}`

  const baseEdgeMap = new Map<string, EdgeDoc>()
  for (const e of baseEdges) {
    baseEdgeMap.set(edgeKey(e), e)
  }

  const addedEdges: EdgeDoc[] = []
  const modifiedEdges: EdgeDoc[] = []
  const seenBranchEdgeKeys = new Set<string>()

  for (const e of branchEdges) {
    const key = edgeKey(e)
    seenBranchEdgeKeys.add(key)
    const base = baseEdgeMap.get(key)
    if (!base) {
      addedEdges.push(e)
    } else {
      // Edges are structural — if they exist with the same from/to/kind, they're identical
      // No "modified" concept for edges
    }
  }

  const deletedEdgeKeys: string[] = []
  for (const [key] of baseEdgeMap) {
    if (!seenBranchEdgeKeys.has(key)) {
      deletedEdgeKeys.push(key)
    }
  }

  return { added, modified, deletedKeys, addedEdges, modifiedEdges, deletedEdgeKeys }
}

/**
 * Check whether two entities with the same ID have different content.
 * We compare the fields that matter for code intelligence — not metadata.
 */
function entityContentChanged(base: EntityDoc, branch: EntityDoc): boolean {
  // Signature change = always a content change
  if ((base as { signature?: string }).signature !== (branch as { signature?: string }).signature) {
    return true
  }
  // Line range change = position shifted (might be from upstream edits)
  if (base.start_line !== branch.start_line || base.end_line !== branch.end_line) {
    return true
  }
  // Body hash change (if available from SCIP)
  if (
    (base as { body_hash?: string }).body_hash !== undefined &&
    (base as { body_hash?: string }).body_hash !== (branch as { body_hash?: string }).body_hash
  ) {
    return true
  }
  return false
}
