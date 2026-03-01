/**
 * Graph analysis activities — pre-compute blast radius (fan-in/fan-out)
 * for all function/method entities and flag high-risk "god functions".
 * Also computes weighted PageRank (L-19) for semantic centrality scoring
 * and L-22 structural fingerprint fields (depth, fan_ratio, boundary, community).
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { ENTRY_POINT_PATTERNS } from "@/lib/justification/dead-code-detector"
import { computePageRank, EDGE_WEIGHTS } from "@/lib/justification/pagerank"
import { logger } from "@/lib/utils/logger"

export interface GraphAnalysisInput {
  orgId: string
  repoId: string
}

/**
 * Multi-source BFS from all entry point entities.
 * Returns map of entityId → depth (hops from nearest entry point).
 * Entry points get depth 0. Disconnected entities are omitted.
 */
function bfsFromEntryPoints(
  entryPointIds: Set<string>,
  adjacency: Map<string, string[]>,
): Map<string, number> {
  const depth = new Map<string, number>()
  const queue: string[] = []

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
 * Lightweight label-propagation community detection.
 * Each node starts with its own community. Iteratively adopts the most
 * common community label among neighbors. Converges in O(k) iterations
 * where k is typically 5-15. Good enough for embedding enrichment.
 */
function detectCommunitiesLightweight(
  entityIds: string[],
  adjacency: Map<string, string[]>,
): Map<string, number> {
  // Initialize: each node is its own community (use index as label)
  const idToIndex = new Map<string, number>()
  for (let i = 0; i < entityIds.length; i++) {
    idToIndex.set(entityIds[i]!, i)
  }

  const labels = new Int32Array(entityIds.length)
  for (let i = 0; i < labels.length; i++) labels[i] = i

  const MAX_ITERATIONS = 20
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = 0

    for (let i = 0; i < entityIds.length; i++) {
      const id = entityIds[i]!
      const neighbors = adjacency.get(id) ?? []
      if (neighbors.length === 0) continue

      // Count neighbor labels
      const labelCounts = new Map<number, number>()
      for (const nid of neighbors) {
        const nIdx = idToIndex.get(nid)
        if (nIdx != null) {
          const nLabel = labels[nIdx]!
          labelCounts.set(nLabel, (labelCounts.get(nLabel) ?? 0) + 1)
        }
      }

      // Adopt most common label
      let bestLabel = labels[i]!
      let bestCount = 0
      labelCounts.forEach((count, label) => {
        if (count > bestCount) {
          bestCount = count
          bestLabel = label
        }
      })

      if (bestLabel !== labels[i]) {
        labels[i] = bestLabel
        changed++
      }
    }

    if (changed === 0) break
  }

  // Remap to contiguous community IDs
  const labelRemap = new Map<number, number>()
  let nextId = 0
  const result = new Map<string, number>()

  for (let i = 0; i < entityIds.length; i++) {
    const rawLabel = labels[i]!
    let communityId = labelRemap.get(rawLabel)
    if (communityId == null) {
      communityId = nextId++
      labelRemap.set(rawLabel, communityId)
    }
    result.set(entityIds[i]!, communityId)
  }

  return result
}

/**
 * Pre-compute fan-in and fan-out for all function/method entities
 * using a single AQL query with COLLECT. Updates entity documents
 * with fan_in, fan_out, and risk_level metadata.
 *
 * L-22: Also computes structural fingerprint fields:
 *   - depth_from_entry: BFS hops from nearest entry point
 *   - fan_ratio: fan_out / (fan_in + 1)
 *   - is_boundary: imports external packages
 *   - community_id: lightweight label-propagation community
 */
export async function precomputeBlastRadius(
  input: GraphAnalysisInput
): Promise<{ updatedCount: number; highRiskCount: number }> {
  const log = logger.child({
    service: "graph-analysis",
    organizationId: input.orgId,
    repoId: input.repoId,
  })

  const container = getContainer()
  heartbeat("fetching entities and edges for blast radius")

  const allEntities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)

  // Filter to callable entities (functions, methods)
  const callableKinds = new Set(["function", "method"])
  const callableEntities = allEntities.filter((e) => callableKinds.has(e.kind))

  if (callableEntities.length === 0) {
    log.info("No callable entities found, skipping blast radius computation")
    return { updatedCount: 0, highRiskCount: 0 }
  }

  heartbeat(`computing fan-in/fan-out for ${callableEntities.length} callable entities`)

  // Count fan-in (inbound calls) and fan-out (outbound calls) per entity
  const callEdges = edges.filter((e) => e.kind === "calls")

  const fanInMap = new Map<string, number>()
  const fanOutMap = new Map<string, number>()

  for (const edge of callEdges) {
    // _from calls _to: _from has fan-out, _to has fan-in
    // Edge _from/_to are in "collection/key" format — extract the key
    const fromId = edge._from.includes("/") ? edge._from.split("/")[1]! : edge._from
    const toId = edge._to.includes("/") ? edge._to.split("/")[1]! : edge._to

    fanOutMap.set(fromId, (fanOutMap.get(fromId) ?? 0) + 1)
    fanInMap.set(toId, (fanInMap.get(toId) ?? 0) + 1)
  }

  // Update entities with blast radius metadata
  const HIGH_THRESHOLD = 10
  const MEDIUM_THRESHOLD = 5
  let highRiskCount = 0
  const updatedEntities: typeof callableEntities = []

  for (const entity of callableEntities) {
    const fanIn = fanInMap.get(entity.id) ?? 0
    const fanOut = fanOutMap.get(entity.id) ?? 0

    let riskLevel: "high" | "medium" | "normal" = "normal"
    if (fanIn >= HIGH_THRESHOLD || fanOut >= HIGH_THRESHOLD) {
      riskLevel = "high"
      highRiskCount++
    } else if (fanIn >= MEDIUM_THRESHOLD || fanOut >= MEDIUM_THRESHOLD) {
      riskLevel = "medium"
    }

    entity.fan_in = fanIn
    entity.fan_out = fanOut
    entity.risk_level = riskLevel
    updatedEntities.push(entity)
  }

  heartbeat(`storing blast radius for ${updatedEntities.length} entities (${highRiskCount} high-risk)`)

  // L-19: Compute weighted PageRank for ALL entities (not just callable)
  heartbeat("computing PageRank scores for all entities")
  const prEdges = edges
    .filter((e) => (EDGE_WEIGHTS[e.kind] ?? 0) > 0)
    .map((e) => ({
      from: e._from.includes("/") ? e._from.split("/")[1]! : e._from,
      to: e._to.includes("/") ? e._to.split("/")[1]! : e._to,
      kind: e.kind,
    }))

  const prResult = computePageRank(
    allEntities.map((e) => e.id),
    prEdges
  )

  // Apply PageRank scores to ALL entities (callable already in updatedEntities)
  const callableIdSet = new Set(callableEntities.map((e) => e.id))
  for (const entity of allEntities) {
    if (!callableIdSet.has(entity.id)) {
      // Non-callable entities also get PageRank metadata
      entity.pagerank = prResult.scores.get(entity.id) ?? 0
      entity.pagerank_percentile = prResult.percentiles.get(entity.id) ?? 0
      updatedEntities.push(entity)
    }
  }
  // Callable entities already in updatedEntities — add PageRank to them
  for (const entity of callableEntities) {
    entity.pagerank = prResult.scores.get(entity.id) ?? 0
    entity.pagerank_percentile = prResult.percentiles.get(entity.id) ?? 0
  }

  // ── L-22: Structural Fingerprint Fields ───────────────────────────────────
  heartbeat("computing structural fingerprint (L-22): BFS depth, boundary, community")

  // Build undirected adjacency for BFS and community detection
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.kind === "calls" || edge.kind === "references" || edge.kind === "imports") {
      const fromId = edge._from.includes("/") ? edge._from.split("/")[1]! : edge._from
      const toId = edge._to.includes("/") ? edge._to.split("/")[1]! : edge._to
      // Directed adjacency for BFS (from → to)
      const fNeighbors = adjacency.get(fromId)
      if (fNeighbors) fNeighbors.push(toId)
      else adjacency.set(fromId, [toId])
    }
  }

  // Build undirected adjacency for community detection
  const undirectedAdj = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.kind === "calls" || edge.kind === "references" || edge.kind === "imports") {
      const fromId = edge._from.includes("/") ? edge._from.split("/")[1]! : edge._from
      const toId = edge._to.includes("/") ? edge._to.split("/")[1]! : edge._to
      const fn = undirectedAdj.get(fromId)
      if (fn) fn.push(toId)
      else undirectedAdj.set(fromId, [toId])
      const tn = undirectedAdj.get(toId)
      if (tn) tn.push(fromId)
      else undirectedAdj.set(toId, [fromId])
    }
  }

  // A. BFS depth from entry points
  const entryPointIds = new Set<string>()
  for (const entity of allEntities) {
    if (ENTRY_POINT_PATTERNS.some((p) => p.test(entity.file_path))) {
      entryPointIds.add(entity.id)
    }
  }
  const depthMap = bfsFromEntryPoints(entryPointIds, adjacency)

  // B. Boundary node detection: entity imports something not in our entity set
  const allEntityIds = new Set(allEntities.map((e) => e.id))
  const boundaryIds = new Set<string>()
  for (const edge of edges) {
    if (edge.kind === "imports") {
      const fromId = edge._from.includes("/") ? edge._from.split("/")[1]! : edge._from
      const toId = edge._to.includes("/") ? edge._to.split("/")[1]! : edge._to
      if (allEntityIds.has(fromId) && !allEntityIds.has(toId)) {
        boundaryIds.add(fromId)
      }
    }
  }

  // C. Community detection (lightweight label propagation)
  const communityMap = detectCommunitiesLightweight(
    allEntities.map((e) => e.id),
    undirectedAdj
  )

  // Apply structural fingerprint fields to ALL entities
  for (const entity of allEntities) {
    const ext = entity as Record<string, unknown>
    const fanIn = (ext.fan_in as number) ?? 0
    const fanOut = (ext.fan_out as number) ?? 0
    ext.depth_from_entry = depthMap.get(entity.id) ?? 99
    ext.fan_ratio = Math.round((fanOut / (fanIn + 1)) * 100) / 100
    ext.is_boundary = boundaryIds.has(entity.id)
    ext.community_id = communityMap.get(entity.id) ?? -1
  }

  heartbeat(`storing ${updatedEntities.length} entities with blast radius + PageRank + structural fingerprint`)

  // Bulk update entities in the graph store
  if (updatedEntities.length > 0) {
    await container.graphStore.bulkUpsertEntities(input.orgId, updatedEntities)
  }

  log.info("Blast radius + PageRank + structural fingerprint pre-computation complete", {
    totalEntities: allEntities.length,
    totalCallable: callableEntities.length,
    highRiskCount,
    callEdges: callEdges.length,
    pagerankIterations: prResult.iterations,
    entryPoints: entryPointIds.size,
    boundaryNodes: boundaryIds.size,
    communities: new Set(communityMap.values()).size,
  })

  return { updatedCount: updatedEntities.length, highRiskCount }
}
