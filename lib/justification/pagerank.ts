/**
 * Weighted PageRank algorithm using power iteration.
 * Self-contained (no graphology dependency) — ~60 lines of core logic.
 *
 * Edge weights encode semantic importance: a `mutates_state` edge transfers
 * more rank than an `imports` edge, so domain-critical entities naturally
 * score higher than logging wrappers.
 */

/** Edge weight table — tunable per edge kind */
export const EDGE_WEIGHTS: Record<string, number> = {
  calls: 0.5,
  references: 0.3,
  mutates_state: 0.9,
  implements: 0.7,
  emits: 0.6,
  listens_to: 0.6,
  extends: 0.3,
  imports: 0.1,
  member_of: 0.05,
  contains: 0.0, // excluded
}

export interface PageRankOptions {
  damping?: number       // default 0.85
  epsilon?: number       // convergence threshold, default 0.0001
  maxIterations?: number // safety cap, default 100
}

export interface PageRankResult {
  scores: Map<string, number>      // entityId → raw PR score
  percentiles: Map<string, number> // entityId → 0-100 percentile rank
  iterations: number               // how many iterations until convergence
}

export function computePageRank(
  entityIds: string[],
  edges: Array<{ from: string; to: string; kind: string }>,
  options?: PageRankOptions
): PageRankResult {
  const d = options?.damping ?? 0.85
  const epsilon = options?.epsilon ?? 0.0001
  const maxIter = options?.maxIterations ?? 100
  const N = entityIds.length

  if (N === 0) {
    return { scores: new Map(), percentiles: new Map(), iterations: 0 }
  }

  // Build adjacency: for each node, outbound edges with weights
  const idSet = new Set(entityIds)
  const outEdges = new Map<string, Array<{ to: string; weight: number }>>()
  const outWeightSum = new Map<string, number>()

  for (const edge of edges) {
    const w = EDGE_WEIGHTS[edge.kind] ?? 0
    if (w <= 0) continue
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue

    let list = outEdges.get(edge.from)
    if (!list) {
      list = []
      outEdges.set(edge.from, list)
    }
    list.push({ to: edge.to, weight: w })
    outWeightSum.set(edge.from, (outWeightSum.get(edge.from) ?? 0) + w)
  }

  // Initialize scores
  const base = 1 / N
  let scores = new Map<string, number>()
  for (const id of entityIds) {
    scores.set(id, base)
  }

  let iterations = 0
  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1
    const next = new Map<string, number>()
    const teleport = (1 - d) / N

    // Start with teleport probability
    for (const id of entityIds) {
      next.set(id, teleport)
    }

    // Distribute rank along edges
    for (const id of entityIds) {
      const pr = scores.get(id)!
      const outs = outEdges.get(id)
      if (!outs) continue
      const totalW = outWeightSum.get(id)!
      for (const { to, weight } of outs) {
        next.set(to, next.get(to)! + d * pr * (weight / totalW))
      }
    }

    // Dangling node handling: nodes with no outbound edges distribute rank evenly
    let danglingSum = 0
    for (const id of entityIds) {
      if (!outEdges.has(id)) {
        danglingSum += scores.get(id)!
      }
    }
    if (danglingSum > 0) {
      const danglingShare = (d * danglingSum) / N
      for (const id of entityIds) {
        next.set(id, next.get(id)! + danglingShare)
      }
    }

    // Check convergence
    let maxDelta = 0
    for (const id of entityIds) {
      const delta = Math.abs(next.get(id)! - scores.get(id)!)
      if (delta > maxDelta) maxDelta = delta
    }

    scores = next

    if (maxDelta < epsilon) break
  }

  // Compute percentile ranks
  const sorted = entityIds
    .map((id) => ({ id, score: scores.get(id)! }))
    .sort((a, b) => a.score - b.score)

  const percentiles = new Map<string, number>()
  for (let i = 0; i < sorted.length; i++) {
    // Percentile: fraction of entities with score <= this entity's score
    percentiles.set(sorted[i]!.id, (i / (N - 1)) * 100)
  }
  // Edge case: single entity gets percentile 100
  if (N === 1) {
    percentiles.set(entityIds[0]!, 100)
  }

  return { scores, percentiles, iterations }
}
