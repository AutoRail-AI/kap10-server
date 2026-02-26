/**
 * Phase 4: Topological Sort — orders entities bottom-up so leaves
 * (functions with no callees) are justified first, and proven
 * justifications propagate upward to callers.
 *
 * Uses Kahn's algorithm for DAG topological ordering.
 * Handles cycles by breaking them and placing cyclic nodes in the last level.
 */

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

/**
 * Topologically sort entities into levels.
 * Level 0 = leaves (no outgoing calls), Level N = roots (only callers).
 *
 * Returns an array of arrays: levels[0] should be justified first.
 */
export function topologicalSortEntities(
  entities: EntityDoc[],
  edges: EdgeDoc[]
): EntityDoc[][] {
  if (entities.length === 0) return []

  // Build adjacency: entity → set of entities it calls (outgoing)
  const entityMap = new Map<string, EntityDoc>()
  for (const e of entities) {
    entityMap.set(e.id, e)
  }

  // Only consider "calls" edges between our entity set
  const entityIdList = entities.map((e) => e.id)
  const entityIds = new Set(entityIdList)

  const outDegree = new Map<string, Set<string>>()
  const inEdges = new Map<string, Set<string>>()

  for (const id of entityIdList) {
    outDegree.set(id, new Set())
    inEdges.set(id, new Set())
  }

  for (const edge of edges) {
    if (edge.kind !== "calls") continue
    const fromId = edge._from.split("/").pop()
    const toId = edge._to.split("/").pop()
    if (!fromId || !toId) continue
    if (!entityIds.has(fromId) || !entityIds.has(toId)) continue
    if (fromId === toId) continue // skip self-loops

    outDegree.get(fromId)!.add(toId)
    inEdges.get(toId)!.add(fromId)
  }

  // Kahn's algorithm: start with leaves (outDegree = 0)
  const levels: EntityDoc[][] = []
  const remaining = new Set(entityIds)

  while (remaining.size > 0) {
    // Find nodes with no remaining outgoing edges (to remaining nodes)
    const currentLevel: string[] = []
    const remainingArr = Array.from(remaining)

    for (const id of remainingArr) {
      const outgoing = outDegree.get(id)!
      const activeOut = Array.from(outgoing).filter((x) => remaining.has(x))
      if (activeOut.length === 0) {
        currentLevel.push(id)
      }
    }

    // If no leaves found, we have a cycle — break it by taking node with fewest outgoing
    if (currentLevel.length === 0) {
      let minOut = Infinity
      let minId = ""
      for (const id of remainingArr) {
        const outgoing = outDegree.get(id)!
        const activeOut = Array.from(outgoing).filter((x) => remaining.has(x)).length
        if (activeOut < minOut) {
          minOut = activeOut
          minId = id
        }
      }
      if (minId) currentLevel.push(minId)
    }

    const levelEntities: EntityDoc[] = []
    for (const id of currentLevel) {
      remaining.delete(id)
      const entity = entityMap.get(id)
      if (entity) levelEntities.push(entity)
    }

    if (levelEntities.length > 0) {
      levels.push(levelEntities)
    }
  }

  return levels
}

/**
 * Same topological sort but returns entity ID arrays instead of full EntityDoc arrays.
 * Used by Temporal activities to keep payloads small (avoids 4MB gRPC limit).
 */
export function topologicalSortEntityIds(
  entities: EntityDoc[],
  edges: EdgeDoc[]
): string[][] {
  if (entities.length === 0) return []

  const entityIdList = entities.map((e) => e.id)
  const entityIds = new Set(entityIdList)

  const outDegree = new Map<string, Set<string>>()

  for (const id of entityIdList) {
    outDegree.set(id, new Set())
  }

  for (const edge of edges) {
    if (edge.kind !== "calls") continue
    const fromId = edge._from.split("/").pop()
    const toId = edge._to.split("/").pop()
    if (!fromId || !toId) continue
    if (!entityIds.has(fromId) || !entityIds.has(toId)) continue
    if (fromId === toId) continue

    outDegree.get(fromId)!.add(toId)
  }

  const levels: string[][] = []
  const remaining = new Set(entityIds)

  while (remaining.size > 0) {
    const currentLevel: string[] = []
    const remainingArr = Array.from(remaining)

    for (const id of remainingArr) {
      const outgoing = outDegree.get(id)!
      const activeOut = Array.from(outgoing).filter((x) => remaining.has(x))
      if (activeOut.length === 0) {
        currentLevel.push(id)
      }
    }

    if (currentLevel.length === 0) {
      let minOut = Infinity
      let minId = ""
      for (const id of remainingArr) {
        const outgoing = outDegree.get(id)!
        const activeOut = Array.from(outgoing).filter((x) => remaining.has(x)).length
        if (activeOut < minOut) {
          minOut = activeOut
          minId = id
        }
      }
      if (minId) currentLevel.push(minId)
    }

    for (const id of currentLevel) {
      remaining.delete(id)
    }

    if (currentLevel.length > 0) {
      levels.push(currentLevel)
    }
  }

  return levels
}
