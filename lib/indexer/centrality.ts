/**
 * Phase 5: Centrality measurement for hub-node detection.
 * Entities with many inbound callers are "hub nodes" that need special handling.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"

// In-memory cache for caller counts within a workflow execution
const callerCountCache = new Map<string, number>()

/**
 * Get the number of inbound callers for an entity.
 * Results are cached for the duration of a workflow execution.
 */
export async function getInboundCallerCount(
  orgId: string,
  entityKey: string,
  graphStore: IGraphStore
): Promise<number> {
  const cacheKey = `${orgId}:${entityKey}`
  const cached = callerCountCache.get(cacheKey)
  if (cached !== undefined) return cached

  const callers = await graphStore.getCallersOf(orgId, entityKey)
  const count = callers.length
  callerCountCache.set(cacheKey, count)
  return count
}

/**
 * Check if an entity is a hub node based on inbound caller count.
 * Hub nodes get special treatment during cascade re-justification.
 */
export function isHubNode(callerCount: number, threshold?: number): boolean {
  const limit = threshold ?? parseInt(process.env.CASCADE_CENTRALITY_THRESHOLD ?? "50", 10)
  return callerCount >= limit
}

/**
 * Clear the caller count cache. Call at the start of each workflow.
 */
export function clearCallerCountCache(): void {
  callerCountCache.clear()
}
