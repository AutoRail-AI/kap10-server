/**
 * Phase 4: Feature Aggregator — groups VERTICAL entities by featureTag,
 * identifies entry points and hot paths for feature map visualization.
 */

import type { JustificationDoc, FeatureAggregation, EntityDoc, EdgeDoc } from "@/lib/ports/types"

/**
 * Aggregate justifications into feature groups.
 * Finds entry points (entities with high inbound but no further callers)
 * and hot paths (most-traversed call chains).
 */
export function aggregateFeatures(
  justifications: JustificationDoc[],
  entities: EntityDoc[],
  edges: EdgeDoc[],
  orgId: string,
  repoId: string
): FeatureAggregation[] {
  // Group by feature tag
  const byTag = new Map<string, JustificationDoc[]>()
  for (const j of justifications) {
    if (!byTag.has(j.feature_tag)) byTag.set(j.feature_tag, [])
    byTag.get(j.feature_tag)!.push(j)
  }

  // Build entity lookup
  const entityMap = new Map<string, EntityDoc>()
  for (const e of entities) entityMap.set(e.id, e)

  // Build caller/callee maps
  const callersOf = new Map<string, Set<string>>()
  const calleesOf = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (edge.kind !== "calls") continue
    const fromId = edge._from.split("/").pop()
    const toId = edge._to.split("/").pop()
    if (!fromId || !toId) continue

    if (!callersOf.has(toId)) callersOf.set(toId, new Set())
    callersOf.get(toId)!.add(fromId)
    if (!calleesOf.has(fromId)) calleesOf.set(fromId, new Set())
    calleesOf.get(fromId)!.add(toId)
  }

  const features: FeatureAggregation[] = []

  for (const [tag, docs] of Array.from(byTag.entries())) {
    const entityIdList = docs.map((d) => d.entity_id)
    const entityIds = new Set(entityIdList)

    // Find entry points: entities in this feature that are called from outside the feature
    const entryPoints: string[] = []
    for (const entityId of entityIdList) {
      const callers = callersOf.get(entityId) ?? new Set()
      const externalCallers = Array.from(callers).filter((c) => !entityIds.has(c))
      if (externalCallers.length > 0 || callers.size === 0) {
        const entity = entityMap.get(entityId)
        if (entity && entity.kind !== "file") {
          entryPoints.push(entityId)
        }
      }
    }

    // Find hot paths: simple BFS from entry points within feature boundary
    const hotPaths: string[][] = []
    for (const ep of entryPoints.slice(0, 3)) {
      const path = findPath(ep, entityIds, calleesOf)
      if (path.length > 1) hotPaths.push(path)
    }

    // Taxonomy breakdown
    const taxonomyBreakdown: Record<string, number> = { VERTICAL: 0, HORIZONTAL: 0, UTILITY: 0 }
    let totalConfidence = 0
    for (const d of docs) {
      taxonomyBreakdown[d.taxonomy] = (taxonomyBreakdown[d.taxonomy] ?? 0) + 1
      totalConfidence += d.confidence
    }

    features.push({
      id: `${repoId}_${tag}`,
      org_id: orgId,
      repo_id: repoId,
      feature_tag: tag,
      entity_count: docs.length,
      entry_points: entryPoints.slice(0, 10),
      hot_paths: hotPaths,
      taxonomy_breakdown: taxonomyBreakdown,
      average_confidence: docs.length > 0 ? totalConfidence / docs.length : 0,
      created_at: new Date().toISOString(),
    })
  }

  return features
}

/** BFS from start within boundary, returns longest path found. */
function findPath(
  start: string,
  boundary: Set<string>,
  calleesOf: Map<string, Set<string>>
): string[] {
  const path = [start]
  let current = start
  const visited = new Set([start])

  for (let depth = 0; depth < 10; depth++) {
    const callees = calleesOf.get(current) ?? new Set()
    let next: string | null = null
    for (const c of Array.from(callees)) {
      if (boundary.has(c) && !visited.has(c)) {
        next = c
        break
      }
    }
    if (!next) break
    visited.add(next)
    path.push(next)
    current = next
  }

  return path
}
