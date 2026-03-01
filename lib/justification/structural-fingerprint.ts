/**
 * L-22: 5D Structural Fingerprint for Graph-RAG embedding enrichment.
 *
 * Computes a unified structural fingerprint per entity from graph topology:
 *   1. pagerank_percentile — centrality (from pre-computed entity metadata)
 *   2. community_id — cluster assignment (from pre-computed entity metadata)
 *   3. depth_from_entry — BFS hops from nearest entry point (0 = entry point itself)
 *   4. fan_ratio — fan_out / (fan_in + 1), >1 = orchestrator, <1 = utility
 *   5. is_boundary — imports external packages
 *
 * Pure functions, no external dependencies beyond types.
 */

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import { ENTRY_POINT_PATTERNS } from "./dead-code-detector"

export interface StructuralFingerprint {
  pagerank_percentile: number  // 0-100
  community_id: number         // cluster assignment, -1 if unknown
  depth_from_entry: number     // BFS hops from nearest entry point (0 = entry point)
  fan_ratio: number            // fan_out / (fan_in + 1)
  is_boundary: boolean         // imports external packages
}

/**
 * Multi-source BFS from all entry point entities.
 * Uses directed edges (calls, references, imports) following from→to direction.
 * Entry points get depth 0. Disconnected entities get depth 99.
 */
function bfsFromEntryPoints(
  entryPointIds: Set<string>,
  adjacency: Map<string, string[]>,
): Map<string, number> {
  const depth = new Map<string, number>()
  const queue: string[] = []

  // Seed all entry points at depth 0
  entryPointIds.forEach((id) => {
    depth.set(id, 0)
    queue.push(id)
  })

  let head = 0
  while (head < queue.length) {
    const current = queue[head++]!
    const currentDepth = depth.get(current)!
    const neighbors = adjacency.get(current) ?? []

    for (const neighbor of neighbors) {
      if (!depth.has(neighbor)) {
        depth.set(neighbor, currentDepth + 1)
        queue.push(neighbor)
      }
    }
  }

  return depth
}

/**
 * Compute 5D structural fingerprints for all entities.
 *
 * Reads pre-computed fields from entity metadata where available
 * (pagerank_percentile, community_id, fan_in, fan_out) and computes
 * BFS depth + boundary detection from edges.
 */
export function computeStructuralFingerprints(
  entities: EntityDoc[],
  edges: EdgeDoc[]
): Map<string, StructuralFingerprint> {
  const result = new Map<string, StructuralFingerprint>()
  const entityIds = new Set(entities.map((e) => e.id))

  // Build adjacency list from directed edges (from→to)
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.kind === "calls" || edge.kind === "references" || edge.kind === "imports") {
      const fromId = edge._from.includes("/") ? edge._from.split("/")[1]! : edge._from
      const toId = edge._to.includes("/") ? edge._to.split("/")[1]! : edge._to
      const neighbors = adjacency.get(fromId)
      if (neighbors) neighbors.push(toId)
      else adjacency.set(fromId, [toId])
    }
  }

  // Identify entry points
  const entryPointIds = new Set<string>()
  for (const entity of entities) {
    if (ENTRY_POINT_PATTERNS.some((p) => p.test(entity.file_path))) {
      entryPointIds.add(entity.id)
    }
  }

  // BFS from entry points
  const depthMap = bfsFromEntryPoints(entryPointIds, adjacency)

  // Detect boundary nodes: entities with outgoing imports to entities NOT in our set
  const boundaryIds = new Set<string>()
  for (const edge of edges) {
    if (edge.kind === "imports") {
      const fromId = edge._from.includes("/") ? edge._from.split("/")[1]! : edge._from
      const toId = edge._to.includes("/") ? edge._to.split("/")[1]! : edge._to
      // If the target entity is not in our repo entity set, the importer is a boundary node
      if (entityIds.has(fromId) && !entityIds.has(toId)) {
        boundaryIds.add(fromId)
      }
    }
  }

  // Build fingerprints
  for (const entity of entities) {
    const ext = entity as Record<string, unknown>
    const pagerankPercentile = (ext.pagerank_percentile as number) ?? 0
    const communityId = (ext.community_id as number) ?? -1
    const fanIn = (ext.fan_in as number) ?? 0
    const fanOut = (ext.fan_out as number) ?? 0
    const depthFromEntry = depthMap.get(entity.id) ?? 99
    const fanRatio = fanOut / (fanIn + 1)
    const isBoundary = boundaryIds.has(entity.id)

    result.set(entity.id, {
      pagerank_percentile: pagerankPercentile,
      community_id: communityId,
      depth_from_entry: depthFromEntry,
      fan_ratio: Math.round(fanRatio * 100) / 100,
      is_boundary: isBoundary,
    })
  }

  return result
}

/**
 * Build a StructuralFingerprint from an entity's pre-computed metadata fields.
 * Used when the full graph isn't available but the entity has been enriched
 * by graph-analysis (Step 4b).
 */
export function buildFingerprintFromEntity(entity: EntityDoc): StructuralFingerprint | null {
  const ext = entity as Record<string, unknown>
  // Require at least pagerank_percentile to be set (indicates Step 4b has run)
  if (ext.pagerank_percentile == null) return null

  return {
    pagerank_percentile: (ext.pagerank_percentile as number) ?? 0,
    community_id: (ext.community_id as number) ?? -1,
    depth_from_entry: (ext.depth_from_entry as number) ?? 99,
    fan_ratio: (ext.fan_ratio as number) ?? 0,
    is_boundary: (ext.is_boundary as boolean) ?? false,
  }
}

/**
 * Convert a structural fingerprint to human-readable tokens for embedding text.
 *
 * Centrality buckets: P0-25 = "low", P25-75 = "medium", P75-95 = "high", P95-100 = "critical"
 * Role buckets: fan_ratio > 2 = "orchestrator", 0.5-2 = "connector", < 0.5 = "leaf/utility"
 */
export function fingerprintToTokens(fp: StructuralFingerprint): string {
  // Centrality bucket
  let centrality: string
  if (fp.pagerank_percentile >= 95) centrality = "critical"
  else if (fp.pagerank_percentile >= 75) centrality = "high"
  else if (fp.pagerank_percentile >= 25) centrality = "medium"
  else centrality = "low"

  // Role bucket
  let role: string
  if (fp.fan_ratio > 2) role = "orchestrator"
  else if (fp.fan_ratio >= 0.5) role = "connector"
  else role = "leaf/utility"

  const parts = [
    `Centrality: ${centrality} (P${Math.round(fp.pagerank_percentile)})`,
    `Depth: ${fp.depth_from_entry === 99 ? "disconnected" : `${fp.depth_from_entry} hops from entry`}`,
    `Role: ${role}`,
    `Boundary: ${fp.is_boundary ? "yes" : "no"}`,
  ]

  if (fp.community_id >= 0) {
    parts.push(`Community: ${fp.community_id}`)
  }

  return parts.join(" | ")
}
