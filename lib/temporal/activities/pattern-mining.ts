/**
 * Phase 6: Pattern Mining activities — Louvain community detection.
 */

import { heartbeat } from "@temporalio/activity"

export interface MinePatternsInput {
  orgId: string
  repoId: string
  maxEntities: number
}

export interface MinePatternsOutput {
  communitiesFound: number
  patternsStored: number
}

export async function minePatterns(input: MinePatternsInput): Promise<MinePatternsOutput> {
  const { getContainer } = require("@/lib/di/container") as typeof import("@/lib/di/container")
  const container = getContainer()

  heartbeat("Fetching entities and edges")

  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  if (entities.length > input.maxEntities) {
    return { communitiesFound: 0, patternsStored: 0 }
  }

  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)

  heartbeat(`Building graph: ${entities.length} entities, ${edges.length} edges`)

  // Build graph using graphology
  const Graph = require("graphology").default as typeof import("graphology").default
  const louvain = require("graphology-communities-louvain") as (graph: InstanceType<typeof Graph>) => Record<string, number>

  const graph = new Graph({ multi: false, type: "undirected" })

  for (const entity of entities) {
    const key = entity.id
    if (!graph.hasNode(key)) {
      graph.addNode(key, { kind: entity.kind, name: entity.name, filePath: entity.file_path })
    }
  }

  for (const edge of edges) {
    const fromKey = edge._from.includes("/") ? edge._from.split("/").pop()! : edge._from
    const toKey = edge._to.includes("/") ? edge._to.split("/").pop()! : edge._to
    if (graph.hasNode(fromKey) && graph.hasNode(toKey) && fromKey !== toKey) {
      if (!graph.hasEdge(fromKey, toKey)) {
        graph.addEdge(fromKey, toKey, { kind: edge.kind })
      }
    }
  }

  heartbeat("Running Louvain community detection")

  const communities = louvain(graph)

  // Group entities by community
  const communityMap = new Map<number, string[]>()
  for (const [nodeId, communityId] of Object.entries(communities)) {
    const cId = communityId as number
    if (!communityMap.has(cId)) communityMap.set(cId, [])
    communityMap.get(cId)!.push(nodeId)
  }

  heartbeat(`Found ${communityMap.size} communities`)

  // Store significant communities as mined patterns
  const crypto = require("node:crypto") as typeof import("node:crypto")
  let patternsStored = 0

  for (const [communityId, entityKeys] of Array.from(communityMap.entries())) {
    // Only store communities with 3+ entities
    if (entityKeys.length < 3) continue

    const motifHash = crypto.createHash("sha256")
      .update(entityKeys.sort().join(","))
      .digest("hex")
      .slice(0, 16)

    // Count edges within this community
    let edgeCount = 0
    for (const edge of edges) {
      const fromKey = edge._from.includes("/") ? edge._from.split("/").pop()! : edge._from
      const toKey = edge._to.includes("/") ? edge._to.split("/").pop()! : edge._to
      if (entityKeys.includes(fromKey) && entityKeys.includes(toKey)) {
        edgeCount++
      }
    }

    // Generate a descriptive label
    const kindCounts = new Map<string, number>()
    for (const key of entityKeys) {
      const attrs = graph.getNodeAttributes(key) as { kind: string }
      kindCounts.set(attrs.kind, (kindCounts.get(attrs.kind) ?? 0) + 1)
    }
    const label = Array.from(kindCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => `${count} ${kind}s`)
      .join(", ")

    await container.graphStore.upsertMinedPattern(input.orgId, {
      id: motifHash,
      org_id: input.orgId,
      repo_id: input.repoId,
      community_id: communityId,
      motif_hash: motifHash,
      entity_keys: entityKeys.slice(0, 100),
      edge_count: edgeCount,
      label: `Community ${communityId}: ${label}`,
      confidence: Math.min(entityKeys.length / 20, 1),
      status: "pending",
      created_at: new Date().toISOString(),
    })
    patternsStored++
  }

  return { communitiesFound: communityMap.size, patternsStored }
}
