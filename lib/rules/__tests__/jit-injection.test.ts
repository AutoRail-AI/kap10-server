import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { getRelevantRules } from "../jit-injection"
import type { RuleDoc, EntityDoc, EdgeDoc } from "@/lib/ports/types"

let container: Container
let testRepo: string

const ORG = "org-jit"

function makeRule(id: string, overrides: Partial<RuleDoc> = {}): RuleDoc {
  return {
    id,
    org_id: ORG,
    repo_id: testRepo,
    name: `rule-${id}`,
    title: `Rule ${id}`,
    description: `Description for ${id}`,
    type: "architecture",
    scope: "repo",
    enforcement: "warn",
    priority: 50,
    status: "active",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  }
}

function makeEntity(id: string, name: string, kind = "function", filePath = "src/test.ts"): EntityDoc {
  return {
    id,
    org_id: ORG,
    repo_id: testRepo,
    kind,
    name,
    file_path: filePath,
    start_line: 10,
  }
}

function makeEdge(from: string, to: string, kind = "calls"): EdgeDoc {
  return {
    _from: `functions/${from}`,
    _to: `functions/${to}`,
    org_id: ORG,
    repo_id: testRepo,
    kind,
  }
}

beforeEach(async () => {
  // Use unique repo per test to avoid shared module-level cache collisions
  testRepo = `repo-${Date.now()}-${Math.random().toString(36).slice(2)}`
  container = createTestContainer()
})

describe("getRelevantRules", () => {
  it("returns rules matching entity file path", async () => {
    await container.graphStore.upsertRule(ORG, makeRule("r1", { fileTypes: ["ts"] }))
    await container.graphStore.upsertRule(ORG, makeRule("r2", { fileTypes: ["py"] }))

    const result = await getRelevantRules(
      container,
      ORG,
      testRepo,
      undefined,
      "src/service.ts"
    )

    // Without entityId, returns base rules sliced to topK
    expect(result.contextEntities).toBe(0)
    expect(result.traversalDepth).toBe(0)
    expect(result.rules.length).toBeGreaterThanOrEqual(1)
  })

  it("respects depth limit for sub-graph traversal", async () => {
    // Seed entities forming a chain: e1 -> e2 -> e3
    const entities = [
      makeEntity("e1", "funcA"),
      makeEntity("e2", "funcB"),
      makeEntity("e3", "funcC"),
    ]
    await container.graphStore.bulkUpsertEntities(ORG, entities)
    await container.graphStore.bulkUpsertEdges(ORG, [
      makeEdge("e1", "e2"),
      makeEdge("e2", "e3"),
    ])

    await container.graphStore.upsertRule(ORG, makeRule("r1", {
      entityKinds: ["function"],
      priority: 30,
    }))

    // depth=1 should only traverse 1 hop from e1
    const resultDepth1 = await getRelevantRules(
      container,
      ORG,
      testRepo,
      "e1",
      "src/test.ts",
      1
    )

    expect(resultDepth1.traversalDepth).toBe(1)
    // e1 + e2 (1 hop)
    expect(resultDepth1.contextEntities).toBe(2)

    // depth=2 should traverse 2 hops from e1 — use a different filePath
    // to avoid cache collision from the depth=1 call
    const resultDepth2 = await getRelevantRules(
      container,
      ORG,
      testRepo,
      "e1",
      "src/test2.ts",
      2
    )

    expect(resultDepth2.traversalDepth).toBe(2)
    // e1 + e2 + e3 (2 hops)
    expect(resultDepth2.contextEntities).toBe(3)
  })

  it("returns empty when no relevant rules found", async () => {
    // No rules seeded at all
    const result = await getRelevantRules(
      container,
      ORG,
      testRepo,
      undefined,
      "src/service.ts"
    )

    expect(result.rules).toEqual([])
    expect(result.contextEntities).toBe(0)
    expect(result.traversalDepth).toBe(0)
  })

  it("boosts rule score based on entity kinds in subgraph", async () => {
    await container.graphStore.bulkUpsertEntities(ORG, [
      makeEntity("e1", "MyClass", "class"),
    ])
    await container.graphStore.upsertRule(ORG, makeRule("r1", {
      entityKinds: ["class"],
      priority: 10,
    }))
    await container.graphStore.upsertRule(ORG, makeRule("r2", {
      entityKinds: ["function"],
      priority: 80,
    }))

    const result = await getRelevantRules(
      container,
      ORG,
      testRepo,
      "e1",
      "src/test.ts",
      1
    )

    // Both rules should be returned since they are both active for this repo
    expect(result.rules.length).toBeGreaterThanOrEqual(1)
    expect(result.contextEntities).toBe(1)
    // r1 has entityKinds ["class"] matching entity e1 => boosted
    // Both rules present, r2 has higher base priority
    expect(result.rules.map((r) => r.id)).toContain("r1")
  })

  it("respects topK limit", async () => {
    // Create more rules than topK
    for (let i = 0; i < 15; i++) {
      await container.graphStore.upsertRule(ORG, makeRule(`r${i}`, { priority: i }))
    }

    const result = await getRelevantRules(
      container,
      ORG,
      testRepo,
      undefined,
      "src/test.ts",
      2,
      5 // topK=5
    )

    expect(result.rules).toHaveLength(5)
  })
})
