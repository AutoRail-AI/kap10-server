/**
 * Tests for topological sort with call/reference edges (L-18a).
 *
 * Verifies that the topological sort produces multi-level ordering
 * when "calls" or "references" edges exist between entities.
 */
import { describe, expect, it } from "vitest"

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

import { topologicalSortEntities, topologicalSortEntityIds } from "../topological-sort"

function makeEntity(id: string): EntityDoc {
  return {
    id,
    org_id: "org1",
    repo_id: "repo1",
    kind: "function",
    name: id,
    file_path: "src/main.ts",
    start_line: 1,
  } as EntityDoc
}

function makeEdge(fromId: string, toId: string, kind: string = "calls"): EdgeDoc {
  return {
    _from: `functions/${fromId}`,
    _to: `functions/${toId}`,
    org_id: "org1",
    repo_id: "repo1",
    kind,
  } as EdgeDoc
}

describe("topologicalSortEntities with call edges", () => {
  it("produces multiple levels for a call chain: A→B→C", () => {
    const entities = [makeEntity("A"), makeEntity("B"), makeEntity("C")]
    const edges = [
      makeEdge("A", "B", "calls"),
      makeEdge("B", "C", "calls"),
    ]

    const levels = topologicalSortEntities(entities, edges)

    // C is a leaf (no outgoing calls) → level 0
    // B calls C → level 1
    // A calls B → level 2
    expect(levels.length).toBe(3)
    expect(levels[0]!.map((e) => e.id)).toEqual(["C"])
    expect(levels[1]!.map((e) => e.id)).toEqual(["B"])
    expect(levels[2]!.map((e) => e.id)).toEqual(["A"])
  })

  it("produces multiple levels with 'references' edges (belt-and-suspenders)", () => {
    const entities = [makeEntity("A"), makeEntity("B"), makeEntity("C")]
    const edges = [
      makeEdge("A", "B", "references"),
      makeEdge("B", "C", "references"),
    ]

    const levels = topologicalSortEntities(entities, edges)

    expect(levels.length).toBe(3)
    expect(levels[0]!.map((e) => e.id)).toEqual(["C"])
    expect(levels[1]!.map((e) => e.id)).toEqual(["B"])
    expect(levels[2]!.map((e) => e.id)).toEqual(["A"])
  })

  it("produces single flat level when no call/reference edges exist", () => {
    const entities = [makeEntity("A"), makeEntity("B"), makeEntity("C")]
    const edges: EdgeDoc[] = [
      makeEdge("A", "B", "imports"),  // non-call edges should be ignored
    ]

    const levels = topologicalSortEntities(entities, edges)

    // All entities on the same level since no call edges
    expect(levels.length).toBe(1)
    expect(levels[0]!.length).toBe(3)
  })

  it("handles cycle: A→B→C→A by breaking it", () => {
    const entities = [makeEntity("A"), makeEntity("B"), makeEntity("C")]
    const edges = [
      makeEdge("A", "B", "calls"),
      makeEdge("B", "C", "calls"),
      makeEdge("C", "A", "calls"),
    ]

    const levels = topologicalSortEntities(entities, edges)

    // All entities should still appear across levels (cycle broken)
    const allIds = levels.flatMap((l) => l.map((e) => e.id)).sort()
    expect(allIds).toEqual(["A", "B", "C"])
    // Should have more than 1 level (cycle break puts some entities on different levels)
    expect(levels.length).toBeGreaterThan(1)
  })

  it("handles diamond dependency: A→B, A→C, B→D, C→D", () => {
    const entities = [makeEntity("A"), makeEntity("B"), makeEntity("C"), makeEntity("D")]
    const edges = [
      makeEdge("A", "B", "calls"),
      makeEdge("A", "C", "calls"),
      makeEdge("B", "D", "calls"),
      makeEdge("C", "D", "calls"),
    ]

    const levels = topologicalSortEntities(entities, edges)

    // D is leaf → level 0
    // B and C call only D → level 1
    // A calls B and C → level 2
    expect(levels.length).toBe(3)
    expect(levels[0]!.map((e) => e.id)).toEqual(["D"])
    expect(levels[1]!.map((e) => e.id).sort()).toEqual(["B", "C"])
    expect(levels[2]!.map((e) => e.id)).toEqual(["A"])
  })

  it("ignores self-loops", () => {
    const entities = [makeEntity("A"), makeEntity("B")]
    const edges = [
      makeEdge("A", "A", "calls"),  // self-loop
      makeEdge("A", "B", "calls"),
    ]

    const levels = topologicalSortEntities(entities, edges)

    expect(levels.length).toBe(2)
    expect(levels[0]!.map((e) => e.id)).toEqual(["B"])
    expect(levels[1]!.map((e) => e.id)).toEqual(["A"])
  })

  it("returns empty for empty input", () => {
    expect(topologicalSortEntities([], [])).toEqual([])
  })
})

describe("topologicalSortEntityIds with call edges", () => {
  it("produces multi-level ID arrays", () => {
    const entities = [makeEntity("A"), makeEntity("B"), makeEntity("C")]
    const edges = [
      makeEdge("A", "B", "calls"),
      makeEdge("B", "C", "calls"),
    ]

    const levels = topologicalSortEntityIds(entities, edges)

    expect(levels.length).toBe(3)
    expect(levels[0]).toEqual(["C"])
    expect(levels[1]).toEqual(["B"])
    expect(levels[2]).toEqual(["A"])
  })

  it("accepts 'references' edges for ID-based sort", () => {
    const entities = [makeEntity("X"), makeEntity("Y")]
    const edges = [makeEdge("X", "Y", "references")]

    const levels = topologicalSortEntityIds(entities, edges)

    expect(levels.length).toBe(2)
    expect(levels[0]).toEqual(["Y"])
    expect(levels[1]).toEqual(["X"])
  })
})
