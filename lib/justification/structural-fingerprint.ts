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

import type { EntityDoc } from "@/lib/ports/types"

/** Sentinel depth value for entities disconnected from all entry points. */
export const DISCONNECTED_DEPTH = 99

export interface StructuralFingerprint {
  pagerank_percentile: number  // 0-100
  community_id: number         // cluster assignment, -1 if unknown
  depth_from_entry: number     // BFS hops from nearest entry point (0 = entry point)
  fan_ratio: number            // fan_out / (fan_in + 1)
  is_boundary: boolean         // imports external packages
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
    depth_from_entry: (ext.depth_from_entry as number) ?? DISCONNECTED_DEPTH,
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
    `Depth: ${fp.depth_from_entry >= DISCONNECTED_DEPTH ? "disconnected" : `${fp.depth_from_entry} hops from entry`}`,
    `Role: ${role}`,
    `Boundary: ${fp.is_boundary ? "yes" : "no"}`,
  ]

  if (fp.community_id >= 0) {
    parts.push(`Community: ${fp.community_id}`)
  }

  return parts.join(" | ")
}
