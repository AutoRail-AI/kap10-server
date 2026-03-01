/**
 * L-21: Community detection via Louvain — reusable pre-justification signal.
 *
 * Extracted from pattern-mining.ts so communities can be written onto entities
 * before justification prompts are built.
 */

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

export interface CommunityResult {
  /** entityId → communityId */
  assignments: Map<string, number>
  /** communityId → info (only communities with 3+ entities) */
  communities: Map<number, CommunityInfo>
  totalCommunities: number
}

export interface CommunityInfo {
  /** Human-readable label: "processPayment, validateCard, StripeAdapter (12 entities)" */
  label: string
  entityCount: number
  /** Top 5 entity names for prompt context */
  topEntities: string[]
}

/**
 * Run Louvain community detection on the entity graph.
 * Returns community assignments and human-readable labels.
 */
export function detectCommunities(
  entities: EntityDoc[],
  edges: EdgeDoc[]
): CommunityResult {
  if (entities.length === 0) {
    return { assignments: new Map(), communities: new Map(), totalCommunities: 0 }
  }

  // Lazy require — graphology may export as default or as the module itself
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const graphologyModule = require("graphology")
  const Graph = (graphologyModule.default ?? graphologyModule) as typeof import("graphology").default
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const louvainModule = require("graphology-communities-louvain")
  const louvain = (louvainModule.default ?? louvainModule) as (
    graph: InstanceType<typeof Graph>
  ) => Record<string, number>

  const graph = new Graph({ multi: false, type: "undirected" })

  // Add nodes
  for (const entity of entities) {
    if (!graph.hasNode(entity.id)) {
      graph.addNode(entity.id, {
        kind: entity.kind,
        name: entity.name,
        pagerank: (entity as Record<string, unknown>).pagerank_percentile as number | undefined,
      })
    }
  }

  // Add edges (dedup, no self-loops)
  for (const edge of edges) {
    const fromKey = edge._from.includes("/") ? edge._from.split("/").pop()! : edge._from
    const toKey = edge._to.includes("/") ? edge._to.split("/").pop()! : edge._to
    if (graph.hasNode(fromKey) && graph.hasNode(toKey) && fromKey !== toKey) {
      if (!graph.hasEdge(fromKey, toKey)) {
        graph.addEdge(fromKey, toKey)
      }
    }
  }

  // Handle disconnected graph (no edges → each node is its own community)
  if (graph.size === 0) {
    return { assignments: new Map(), communities: new Map(), totalCommunities: 0 }
  }

  const rawAssignments = louvain(graph)

  // Build assignments map
  const assignments = new Map<string, number>()
  for (const [nodeId, communityId] of Object.entries(rawAssignments)) {
    assignments.set(nodeId, communityId as number)
  }

  // Group into communities
  const communityMembers = new Map<number, string[]>()
  for (const [nodeId, communityId] of assignments) {
    const members = communityMembers.get(communityId)
    if (members) {
      members.push(nodeId)
    } else {
      communityMembers.set(communityId, [nodeId])
    }
  }

  // Build entity lookup for name/pagerank
  const entityMap = new Map(entities.map((e) => [e.id, e]))

  // Build CommunityInfo for communities with 3+ entities
  const communities = new Map<number, CommunityInfo>()
  for (const [communityId, memberIds] of communityMembers) {
    if (memberIds.length < 3) continue

    // Sort by pagerank_percentile descending, then alphabetical
    const sorted = memberIds
      .map((id) => entityMap.get(id))
      .filter((e): e is EntityDoc => e != null)
      .sort((a, b) => {
        const prA = ((a as Record<string, unknown>).pagerank_percentile as number) ?? 0
        const prB = ((b as Record<string, unknown>).pagerank_percentile as number) ?? 0
        if (prB !== prA) return prB - prA
        return a.name.localeCompare(b.name)
      })

    const topEntities = sorted.slice(0, 5).map((e) => e.name)
    const label = `${topEntities.join(", ")} (${memberIds.length} entities)`

    communities.set(communityId, {
      label,
      entityCount: memberIds.length,
      topEntities,
    })
  }

  return {
    assignments,
    communities,
    totalCommunities: communityMembers.size,
  }
}
