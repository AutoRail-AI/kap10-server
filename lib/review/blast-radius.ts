/**
 * Blast radius — N-hop ArangoDB traversal from changed entities to API/UI boundaries.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"
import type { BlastRadiusSummary, EntityDoc } from "@/lib/ports/types"

const BOUNDARY_KINDS = new Set(["api_route", "component", "webhook_handler", "cron_job"])

export async function buildBlastRadiusSummary(
  orgId: string,
  affectedEntities: Array<EntityDoc & { changedLines?: unknown }>,
  graphStore: IGraphStore,
  maxHops: number = 5,
  maxEntities: number = 20
): Promise<BlastRadiusSummary[]> {
  const summaries: BlastRadiusSummary[] = []

  // Sort by likely importance (functions/methods first) and cap
  const entitiesToAnalyze = affectedEntities
    .filter((e) => e.kind === "function" || e.kind === "method")
    .slice(0, maxEntities)

  for (const entity of entitiesToAnalyze) {
    // Use getSubgraph for N-hop traversal
    const subgraph = await graphStore.getSubgraph(orgId, entity.id, maxHops)

    // Find boundary nodes in the subgraph
    const boundaries: BlastRadiusSummary["upstreamBoundaries"] = []
    for (const node of subgraph.entities) {
      if (BOUNDARY_KINDS.has(node.kind) && node.id !== entity.id) {
        // Calculate approximate depth (number of edge hops)
        const depth = estimateDepth(entity.id, node.id, subgraph)
        boundaries.push({
          name: node.name,
          kind: node.kind,
          filePath: node.file_path,
          depth,
          path: `${entity.name} → ... → ${node.name}`,
        })
      }
    }

    if (boundaries.length > 0) {
      // Get caller count
      const callers = await graphStore.getCallersOf(orgId, entity.id)

      summaries.push({
        entity: entity.name,
        filePath: entity.file_path,
        upstreamBoundaries: boundaries.slice(0, 5),
        callerCount: callers.length,
      })
    }
  }

  return summaries
}

function estimateDepth(
  fromId: string,
  toId: string,
  subgraph: { entities: EntityDoc[]; edges: Array<{ _from: string; _to: string }> }
): number {
  // Simple BFS to find shortest path
  const visited = new Set<string>([fromId])
  let frontier = [fromId]
  let depth = 0

  while (frontier.length > 0 && depth < 10) {
    depth++
    const nextFrontier: string[] = []
    for (const nodeId of frontier) {
      for (const edge of subgraph.edges) {
        const fromKey = edge._from.split("/").pop() ?? ""
        const toKey = edge._to.split("/").pop() ?? ""
        let neighbor: string | null = null
        if (fromKey === nodeId) neighbor = toKey
        else if (toKey === nodeId) neighbor = fromKey
        if (neighbor && !visited.has(neighbor)) {
          if (neighbor === toId) return depth
          visited.add(neighbor)
          nextFrontier.push(neighbor)
        }
      }
    }
    frontier = nextFrontier
  }

  return depth
}
