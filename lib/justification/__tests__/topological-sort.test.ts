import { describe, it, expect } from "vitest"
import { topologicalSortEntities, topologicalSortEntityIds } from "../topological-sort"
import type { EntityDoc, EdgeDoc } from "@/lib/ports/types"

function makeEntity(id: string): EntityDoc {
  return { id, org_id: "o", repo_id: "r", kind: "function", name: id, file_path: "a.ts" }
}

function makeEdge(from: string, to: string): EdgeDoc {
  return { _from: `functions/${from}`, _to: `functions/${to}`, kind: "calls", org_id: "o", repo_id: "r" }
}

describe("topologicalSortEntities", () => {
  it("returns empty for empty input", () => {
    expect(topologicalSortEntities([], [])).toEqual([])
  })

  it("returns single level for single entity", () => {
    const entities = [makeEntity("a")]
    const result = topologicalSortEntities(entities, [])
    expect(result).toHaveLength(1)
    expect(result[0]![0]!.id).toBe("a")
  })

  it("puts leaves (no callees) in level 0", () => {
    // a → b → c
    const entities = [makeEntity("a"), makeEntity("b"), makeEntity("c")]
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")]
    const result = topologicalSortEntities(entities, edges)

    // c has no outgoing calls → level 0
    // b calls c → level 1
    // a calls b → level 2
    expect(result).toHaveLength(3)
    expect(result[0]!.map((e) => e.id)).toEqual(["c"])
    expect(result[1]!.map((e) => e.id)).toEqual(["b"])
    expect(result[2]!.map((e) => e.id)).toEqual(["a"])
  })

  it("handles diamond dependency graph", () => {
    // a → b, a → c, b → d, c → d
    const entities = [makeEntity("a"), makeEntity("b"), makeEntity("c"), makeEntity("d")]
    const edges = [makeEdge("a", "b"), makeEdge("a", "c"), makeEdge("b", "d"), makeEdge("c", "d")]

    const result = topologicalSortEntities(entities, edges)
    expect(result.length).toBeGreaterThanOrEqual(3)

    // d must be in level 0, a must be last
    expect(result[0]!.map((e) => e.id)).toContain("d")
    const lastLevel = result[result.length - 1]!
    expect(lastLevel.map((e) => e.id)).toContain("a")
  })

  it("handles cycles by breaking them", () => {
    // a → b → a (cycle)
    const entities = [makeEntity("a"), makeEntity("b")]
    const edges = [makeEdge("a", "b"), makeEdge("b", "a")]

    const result = topologicalSortEntities(entities, edges)
    // Should still return all entities across levels
    const allIds = result.flat().map((e) => e.id)
    expect(allIds).toContain("a")
    expect(allIds).toContain("b")
  })

  it("ignores non-calls edges", () => {
    const entities = [makeEntity("a"), makeEntity("b")]
    const edges: EdgeDoc[] = [
      { _from: "functions/a", _to: "functions/b", kind: "imports", org_id: "o", repo_id: "r" },
    ]
    const result = topologicalSortEntities(entities, edges)
    // Both entities are leaves (no calls edges)
    expect(result).toHaveLength(1)
    expect(result[0]!).toHaveLength(2)
  })
})

describe("topologicalSortEntityIds", () => {
  it("returns empty for empty input", () => {
    expect(topologicalSortEntityIds([], [])).toEqual([])
  })

  it("returns string IDs instead of EntityDoc objects", () => {
    const entities = [makeEntity("a")]
    const result = topologicalSortEntityIds(entities, [])
    expect(result).toHaveLength(1)
    expect(result[0]![0]).toBe("a")
    expect(typeof result[0]![0]).toBe("string")
  })

  it("puts leaves (no callees) in level 0", () => {
    // a → b → c
    const entities = [makeEntity("a"), makeEntity("b"), makeEntity("c")]
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")]
    const result = topologicalSortEntityIds(entities, edges)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(["c"])
    expect(result[1]).toEqual(["b"])
    expect(result[2]).toEqual(["a"])
  })

  it("handles diamond dependency graph", () => {
    const entities = [makeEntity("a"), makeEntity("b"), makeEntity("c"), makeEntity("d")]
    const edges = [makeEdge("a", "b"), makeEdge("a", "c"), makeEdge("b", "d"), makeEdge("c", "d")]

    const result = topologicalSortEntityIds(entities, edges)
    expect(result.length).toBeGreaterThanOrEqual(3)

    expect(result[0]).toContain("d")
    const lastLevel = result[result.length - 1]!
    expect(lastLevel).toContain("a")
  })

  it("handles cycles by breaking them", () => {
    const entities = [makeEntity("a"), makeEntity("b")]
    const edges = [makeEdge("a", "b"), makeEdge("b", "a")]

    const result = topologicalSortEntityIds(entities, edges)
    const allIds = result.flat()
    expect(allIds).toContain("a")
    expect(allIds).toContain("b")
  })

  it("produces same ordering as topologicalSortEntities", () => {
    const entities = [makeEntity("a"), makeEntity("b"), makeEntity("c")]
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")]

    const entityResult = topologicalSortEntities(entities, edges)
    const idResult = topologicalSortEntityIds(entities, edges)

    expect(idResult.length).toBe(entityResult.length)
    for (let i = 0; i < idResult.length; i++) {
      const entityIds = entityResult[i]!.map((e) => e.id)
      expect(idResult[i]).toEqual(entityIds)
    }
  })
})
