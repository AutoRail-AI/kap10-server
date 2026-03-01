import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import { describe, expect, it } from "vitest"
import { detectCommunities } from "../community-detection"

function makeEntity(id: string, name: string, pagerank?: number): EntityDoc {
  return {
    id,
    org_id: "org1",
    repo_id: "repo1",
    name,
    kind: "function",
    file_path: `src/${name}.ts`,
    start_line: 1,
    ...(pagerank != null ? { pagerank_percentile: pagerank } : {}),
  } as EntityDoc
}

function makeEdge(from: string, to: string): EdgeDoc {
  return {
    _from: `functions/${from}`,
    _to: `functions/${to}`,
    kind: "calls",
    org_id: "org1",
    repo_id: "repo1",
  } as EdgeDoc
}

describe("detectCommunities", () => {
  it("returns empty for empty graph", () => {
    const result = detectCommunities([], [])
    expect(result.assignments.size).toBe(0)
    expect(result.communities.size).toBe(0)
    expect(result.totalCommunities).toBe(0)
  })

  it("detects two disconnected clusters as separate communities", () => {
    // Cluster A: a1-a2-a3 fully connected
    // Cluster B: b1-b2-b3 fully connected
    const entities = [
      makeEntity("a1", "processPayment"),
      makeEntity("a2", "validateCard"),
      makeEntity("a3", "chargeStripe"),
      makeEntity("b1", "sendEmail"),
      makeEntity("b2", "renderTemplate"),
      makeEntity("b3", "queueNotification"),
    ]
    const edges = [
      makeEdge("a1", "a2"),
      makeEdge("a2", "a3"),
      makeEdge("a1", "a3"),
      makeEdge("b1", "b2"),
      makeEdge("b2", "b3"),
      makeEdge("b1", "b3"),
    ]

    const result = detectCommunities(entities, edges)
    expect(result.totalCommunities).toBeGreaterThanOrEqual(2)
    expect(result.communities.size).toBeGreaterThanOrEqual(2)

    // Each community should have 3 entities
    for (const [, info] of result.communities) {
      expect(info.entityCount).toBe(3)
    }
  })

  it("puts all-connected graph into a single community", () => {
    const entities = [
      makeEntity("a", "alpha"),
      makeEntity("b", "beta"),
      makeEntity("c", "gamma"),
    ]
    const edges = [
      makeEdge("a", "b"),
      makeEdge("b", "c"),
      makeEdge("a", "c"),
    ]

    const result = detectCommunities(entities, edges)
    // All connected → single community
    expect(result.communities.size).toBe(1)
  })

  it("generates labels with top entity names", () => {
    const entities = [
      makeEntity("a", "processPayment", 90),
      makeEntity("b", "validateCard", 80),
      makeEntity("c", "chargeStripe", 70),
      makeEntity("d", "refundPayment", 60),
    ]
    const edges = [
      makeEdge("a", "b"),
      makeEdge("a", "c"),
      makeEdge("a", "d"),
      makeEdge("b", "c"),
      makeEdge("c", "d"),
    ]

    const result = detectCommunities(entities, edges)
    expect(result.communities.size).toBeGreaterThanOrEqual(1)

    const community = Array.from(result.communities.values())[0]!
    expect(community.label).toContain("entities)")
    expect(community.topEntities.length).toBeGreaterThan(0)
    // Highest pagerank entity should be first
    expect(community.topEntities[0]).toBe("processPayment")
  })

  it("excludes communities with fewer than 3 entities", () => {
    const entities = [
      makeEntity("a", "alpha"),
      makeEntity("b", "beta"),
      makeEntity("c", "gamma"),
      makeEntity("d", "delta"),
      makeEntity("e", "epsilon"),
    ]
    // a-b pair only, c-d-e cluster
    const edges = [
      makeEdge("a", "b"),
      makeEdge("c", "d"),
      makeEdge("d", "e"),
      makeEdge("c", "e"),
    ]

    const result = detectCommunities(entities, edges)
    // The a-b pair should NOT be in the communities map (only 2 members)
    for (const [, info] of result.communities) {
      expect(info.entityCount).toBeGreaterThanOrEqual(3)
    }
  })

  it("handles self-loops gracefully", () => {
    const entities = [
      makeEntity("a", "alpha"),
      makeEntity("b", "beta"),
      makeEntity("c", "gamma"),
    ]
    const edges = [
      makeEdge("a", "a"), // self-loop
      makeEdge("a", "b"),
      makeEdge("b", "c"),
      makeEdge("a", "c"),
    ]

    // Should not throw
    const result = detectCommunities(entities, edges)
    expect(result.assignments.size).toBeGreaterThan(0)
  })
})
