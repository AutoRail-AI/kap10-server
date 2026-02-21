import { describe, it, expect } from "vitest"
import { diffEntitySets } from "@/lib/indexer/incremental"
import type { EntityDoc } from "@/lib/ports/types"

function makeEntity(overrides: Partial<EntityDoc> & { id: string }): EntityDoc {
  return {
    org_id: "org-1",
    repo_id: "repo-1",
    kind: "function",
    name: "myFunc",
    file_path: "src/index.ts",
    ...overrides,
  }
}

describe("diffEntitySets", () => {
  it("returns empty diff when both sets are equal", () => {
    const entities = [
      makeEntity({ id: "e1", name: "alpha", signature: "fn alpha()", body_hash: "h1", start_line: 1 }),
      makeEntity({ id: "e2", name: "beta", signature: "fn beta()", body_hash: "h2", start_line: 10 }),
    ]
    const result = diffEntitySets(entities, [...entities])
    expect(result.added).toHaveLength(0)
    expect(result.updated).toHaveLength(0)
    expect(result.deleted).toHaveLength(0)
  })

  it("detects added entities", () => {
    const oldEntities = [makeEntity({ id: "e1", name: "alpha" })]
    const newEntities = [
      makeEntity({ id: "e1", name: "alpha" }),
      makeEntity({ id: "e2", name: "beta" }),
    ]
    const result = diffEntitySets(oldEntities, newEntities)
    expect(result.added).toHaveLength(1)
    expect(result.added[0]!.id).toBe("e2")
    expect(result.updated).toHaveLength(0)
    expect(result.deleted).toHaveLength(0)
  })

  it("detects deleted entities", () => {
    const oldEntities = [
      makeEntity({ id: "e1", name: "alpha" }),
      makeEntity({ id: "e2", name: "beta" }),
    ]
    const newEntities = [makeEntity({ id: "e1", name: "alpha" })]
    const result = diffEntitySets(oldEntities, newEntities)
    expect(result.added).toHaveLength(0)
    expect(result.updated).toHaveLength(0)
    expect(result.deleted).toHaveLength(1)
    expect(result.deleted[0]!.id).toBe("e2")
  })

  it("detects updated entities (name change)", () => {
    const oldEntities = [makeEntity({ id: "e1", name: "alpha" })]
    const newEntities = [makeEntity({ id: "e1", name: "alphaRenamed" })]
    const result = diffEntitySets(oldEntities, newEntities)
    expect(result.added).toHaveLength(0)
    expect(result.updated).toHaveLength(1)
    expect(result.updated[0]!.name).toBe("alphaRenamed")
    expect(result.deleted).toHaveLength(0)
  })

  it("detects updated entities (signature change)", () => {
    const oldEntities = [makeEntity({ id: "e1", signature: "fn foo()" })]
    const newEntities = [makeEntity({ id: "e1", signature: "fn foo(x: number)" })]
    const result = diffEntitySets(oldEntities, newEntities)
    expect(result.updated).toHaveLength(1)
    expect(result.updated[0]!.signature).toBe("fn foo(x: number)")
  })

  it("detects updated entities (body_hash change)", () => {
    const oldEntities = [makeEntity({ id: "e1", body_hash: "aaa" })]
    const newEntities = [makeEntity({ id: "e1", body_hash: "bbb" })]
    const result = diffEntitySets(oldEntities, newEntities)
    expect(result.updated).toHaveLength(1)
    expect(result.updated[0]!.body_hash).toBe("bbb")
  })

  it("detects updated entities (start_line change)", () => {
    const oldEntities = [makeEntity({ id: "e1", start_line: 5 })]
    const newEntities = [makeEntity({ id: "e1", start_line: 20 })]
    const result = diffEntitySets(oldEntities, newEntities)
    expect(result.updated).toHaveLength(1)
    expect(result.updated[0]!.start_line).toBe(20)
  })

  it("handles complex diff with adds, updates, and deletes", () => {
    const oldEntities = [
      makeEntity({ id: "e1", name: "alpha", body_hash: "h1" }),
      makeEntity({ id: "e2", name: "beta", body_hash: "h2" }),
      makeEntity({ id: "e3", name: "gamma", body_hash: "h3" }),
    ]
    const newEntities = [
      makeEntity({ id: "e1", name: "alpha", body_hash: "h1" }), // unchanged
      makeEntity({ id: "e2", name: "betaV2", body_hash: "h2" }), // updated (name)
      makeEntity({ id: "e4", name: "delta", body_hash: "h4" }), // added
    ]
    const result = diffEntitySets(oldEntities, newEntities)
    expect(result.added).toHaveLength(1)
    expect(result.added[0]!.id).toBe("e4")
    expect(result.updated).toHaveLength(1)
    expect(result.updated[0]!.id).toBe("e2")
    expect(result.deleted).toHaveLength(1)
    expect(result.deleted[0]!.id).toBe("e3")
  })

  it("handles empty inputs", () => {
    // Both empty
    const result1 = diffEntitySets([], [])
    expect(result1.added).toHaveLength(0)
    expect(result1.updated).toHaveLength(0)
    expect(result1.deleted).toHaveLength(0)

    // Old empty (all added)
    const newEntities = [makeEntity({ id: "e1" })]
    const result2 = diffEntitySets([], newEntities)
    expect(result2.added).toHaveLength(1)
    expect(result2.deleted).toHaveLength(0)

    // New empty (all deleted)
    const oldEntities = [makeEntity({ id: "e1" })]
    const result3 = diffEntitySets(oldEntities, [])
    expect(result3.added).toHaveLength(0)
    expect(result3.deleted).toHaveLength(1)
  })
})
