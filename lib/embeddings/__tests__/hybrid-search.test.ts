import { describe, expect, it } from "vitest"
import { createTestContainer } from "@/lib/di/container"
import { hybridSearch, reciprocalRankFusion, tokenizeQuery } from "../hybrid-search"

describe("tokenizeQuery", () => {
  it("removes stop words", () => {
    const tokens = tokenizeQuery("functions that validate user permissions")
    expect(tokens).toContain("validate")
    expect(tokens).toContain("user")
    expect(tokens).toContain("permissions")
    expect(tokens).not.toContain("that")
  })

  it("returns empty array for empty query", () => {
    expect(tokenizeQuery("")).toEqual([])
  })

  it("lowercases tokens", () => {
    const tokens = tokenizeQuery("ValidatePayment")
    expect(tokens).toContain("validatepayment")
  })
})

describe("reciprocalRankFusion", () => {
  it("merges two rankings with no overlap into union", () => {
    const ranking1 = [
      { entityKey: "a", entityName: "fnA", entityType: "function", filePath: "a.ts", score: 0.9 },
    ]
    const ranking2 = [
      { entityKey: "b", entityName: "fnB", entityType: "function", filePath: "b.ts", score: 0.8 },
    ]
    const result = reciprocalRankFusion([ranking1, ranking2], [], 60, 10)
    expect(result).toHaveLength(2)
    // Both get same RRF score since both rank 1 in their respective lists
    expect(result[0]!.score).toBeCloseTo(result[1]!.score, 5)
  })

  it("gives higher score to entity appearing in both rankings", () => {
    const ranking1 = [
      { entityKey: "a", entityName: "fnA", entityType: "function", filePath: "a.ts", score: 0.9 },
      { entityKey: "b", entityName: "fnB", entityType: "function", filePath: "b.ts", score: 0.5 },
    ]
    const ranking2 = [
      { entityKey: "a", entityName: "fnA", entityType: "function", filePath: "a.ts", score: 0.8 },
    ]
    const result = reciprocalRankFusion([ranking1, ranking2], [], 60, 10)
    const aItem = result.find(r => r.entityKey === "a")!
    const bItem = result.find(r => r.entityKey === "b")!
    expect(aItem.score).toBeGreaterThan(bItem.score)
  })

  it("boosts exact name match to score 1.0", () => {
    const ranking1 = [
      { entityKey: "other", entityName: "otherFn", entityType: "function", filePath: "a.ts", score: 0.99 },
      { entityKey: "match", entityName: "validatePayment", entityType: "function", filePath: "b.ts", score: 0.1 },
    ]
    const result = reciprocalRankFusion([ranking1], ["validatePayment"], 60, 10)
    expect(result[0]!.entityKey).toBe("match")
    expect(result[0]!.score).toBe(1.0)
  })

  it("exact match boost is case-insensitive", () => {
    const ranking1 = [
      { entityKey: "a", entityName: "ValidatePayment", entityType: "function", filePath: "a.ts", score: 0.5 },
    ]
    const result = reciprocalRankFusion([ranking1], ["validatepayment"], 60, 10)
    expect(result[0]!.score).toBe(1.0)
  })

  it("sorts multiple exact matches alphabetically", () => {
    const ranking1 = [
      { entityKey: "b", entityName: "zebra", entityType: "function", filePath: "b.ts", score: 0.5 },
      { entityKey: "a", entityName: "alpha", entityType: "function", filePath: "a.ts", score: 0.5 },
    ]
    const result = reciprocalRankFusion([ranking1], ["zebra", "alpha"], 60, 10)
    // Both boosted to 1.0, sorted alphabetically
    expect(result[0]!.entityName).toBe("alpha")
    expect(result[1]!.entityName).toBe("zebra")
  })

  it("handles empty rankings", () => {
    const result = reciprocalRankFusion([], [], 60, 10)
    expect(result).toHaveLength(0)
  })

  it("respects limit parameter", () => {
    const ranking = Array.from({ length: 20 }, (_, i) => ({
      entityKey: `e${i}`, entityName: `fn${i}`, entityType: "function", filePath: `${i}.ts`, score: 1 - i * 0.01,
    }))
    const result = reciprocalRankFusion([ranking], [], 60, 5)
    expect(result).toHaveLength(5)
  })
})

describe("hybridSearch", () => {
  it("returns results in hybrid mode", async () => {
    const container = createTestContainer()
    // Seed some entities into the graph store
    await container.graphStore.bulkUpsertEntities("org1", [
      { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "authenticate", file_path: "auth.ts", signature: "(req: Request) => boolean" },
      { id: "e2", org_id: "org1", repo_id: "repo1", kind: "function", name: "validateToken", file_path: "auth.ts", signature: "(token: string) => boolean" },
    ])
    // Also seed embeddings
    const embeddings = await container.vectorSearch.embed(["authenticate function", "validate token function"])
    await container.vectorSearch.upsert(
      ["e1", "e2"],
      embeddings,
      [
        { orgId: "org1", repoId: "repo1", entityKey: "e1", entityType: "function", entityName: "authenticate", filePath: "auth.ts", textContent: "authenticate function" },
        { orgId: "org1", repoId: "repo1", entityKey: "e2", entityType: "function", entityName: "validateToken", filePath: "auth.ts", textContent: "validate token function" },
      ]
    )

    const result = await hybridSearch({
      query: "authenticate",
      orgId: "org1",
      repoId: "repo1",
      mode: "hybrid",
      limit: 10,
    }, container)

    expect(result.results.length).toBeGreaterThan(0)
    expect(result.meta.mode).toBe("hybrid")
    expect(result.meta.queryTimeMs).toBeGreaterThanOrEqual(0)
  })

  it("returns keyword-only results in keyword mode", async () => {
    const container = createTestContainer()
    await container.graphStore.bulkUpsertEntities("org1", [
      { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "processPayment", file_path: "pay.ts" },
    ])

    const result = await hybridSearch({
      query: "processPayment",
      orgId: "org1",
      repoId: "repo1",
      mode: "keyword",
      limit: 10,
    }, container)

    expect(result.results.length).toBeGreaterThan(0)
    expect(result.meta.mode).toBe("keyword")
  })

  it("returns semantic-only results in semantic mode", async () => {
    const container = createTestContainer()
    const embeddings = await container.vectorSearch.embed(["payment processing function"])
    await container.vectorSearch.upsert(
      ["e1"],
      embeddings,
      [{ orgId: "org1", repoId: "repo1", entityKey: "e1", entityType: "function", entityName: "processPayment", filePath: "pay.ts", textContent: "payment processing" }]
    )

    const result = await hybridSearch({
      query: "payment processing",
      orgId: "org1",
      repoId: "repo1",
      mode: "semantic",
      limit: 10,
    }, container)

    expect(result.meta.mode).toBe("semantic")
  })

  it("returns empty results with no data", async () => {
    const container = createTestContainer()
    const result = await hybridSearch({
      query: "nonexistent",
      orgId: "org1",
      repoId: "repo1",
      mode: "hybrid",
      limit: 10,
    }, container)

    expect(result.results).toHaveLength(0)
  })
})
