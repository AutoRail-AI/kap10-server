import { describe, expect, it } from "vitest"
import { createTestContainer } from "@/lib/di/container"
import type { McpAuthContext } from "../../auth"
import { handleFindSimilar, handleSemanticSearch } from "../semantic"

const mockCtx: McpAuthContext = {
  authMode: "api_key",
  userId: "user-1",
  orgId: "org-1",
  repoId: "repo-1",
  scopes: ["mcp:read"],
}

describe("semantic_search", () => {
  it("returns error for empty query", async () => {
    const container = createTestContainer()
    const result = await handleSemanticSearch({ query: "" }, mockCtx, container)
    expect(result.isError).toBe(true)
  })

  it("returns error when no repoId in context", async () => {
    const container = createTestContainer()
    const ctxNoRepo: McpAuthContext = { ...mockCtx, repoId: undefined }
    const result = await handleSemanticSearch({ query: "test" }, ctxNoRepo, container)
    expect(result.isError).toBe(true)
  })

  it("returns results for valid query", async () => {
    const container = createTestContainer()
    // Seed graph store with entities
    await container.graphStore.bulkUpsertEntities("org-1", [
      { id: "e1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "authenticate", file_path: "auth.ts", signature: "(req: Request) => boolean" },
    ])
    // Seed vector store with embeddings
    const embeddings = await container.vectorSearch.embed(["Function: authenticate\nFile: auth.ts"])
    await container.vectorSearch.upsert(
      ["e1"],
      embeddings,
      [{ orgId: "org-1", repoId: "repo-1", entityKey: "e1", entityType: "function", entityName: "authenticate", filePath: "auth.ts", textContent: "Function: authenticate" }]
    )

    const result = await handleSemanticSearch({ query: "authenticate", mode: "hybrid" }, mockCtx, container)
    expect(result.isError).toBeUndefined()
    const content = JSON.parse(result.content[0]!.text) as Record<string, unknown>
    expect(content.query).toBe("authenticate")
    expect(content.mode).toBe("hybrid")
  })

  it("clamps limit to 50", async () => {
    const container = createTestContainer()
    const result = await handleSemanticSearch({ query: "test", limit: 100 }, mockCtx, container)
    // Should not error
    expect(result.isError).toBeUndefined()
  })

  it("returns keyword-only results with mode=keyword", async () => {
    const container = createTestContainer()
    await container.graphStore.bulkUpsertEntities("org-1", [
      { id: "e1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "processOrder", file_path: "order.ts" },
    ])

    const result = await handleSemanticSearch({ query: "processOrder", mode: "keyword" }, mockCtx, container)
    expect(result.isError).toBeUndefined()
    const content = JSON.parse(result.content[0]!.text) as Record<string, unknown>
    expect(content.mode).toBe("keyword")
  })
})

describe("find_similar", () => {
  it("returns error for empty entityKey", async () => {
    const container = createTestContainer()
    const result = await handleFindSimilar({ entityKey: "" }, mockCtx, container)
    expect(result.isError).toBe(true)
  })

  it("returns error when no repoId in context", async () => {
    const container = createTestContainer()
    const ctxNoRepo: McpAuthContext = { ...mockCtx, repoId: undefined }
    const result = await handleFindSimilar({ entityKey: "e1" }, ctxNoRepo, container)
    expect(result.isError).toBe(true)
  })

  it("finds similar entities using existing embedding", async () => {
    const container = createTestContainer()
    // Seed entities in graph
    await container.graphStore.bulkUpsertEntities("org-1", [
      { id: "e1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "validateJWT", file_path: "auth.ts" },
      { id: "e2", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "validateToken", file_path: "auth.ts" },
    ])
    // Seed embeddings
    const embeddings = await container.vectorSearch.embed(["validate JWT function", "validate token function"])
    await container.vectorSearch.upsert(
      ["e1", "e2"],
      embeddings,
      [
        { orgId: "org-1", repoId: "repo-1", entityKey: "e1", entityType: "function", entityName: "validateJWT", filePath: "auth.ts", textContent: "validate JWT" },
        { orgId: "org-1", repoId: "repo-1", entityKey: "e2", entityType: "function", entityName: "validateToken", filePath: "auth.ts", textContent: "validate token" },
      ]
    )

    const result = await handleFindSimilar({ entityKey: "e1", limit: 5 }, mockCtx, container)
    expect(result.isError).toBeUndefined()
    const content = JSON.parse(result.content[0]!.text) as Record<string, unknown>
    expect(content.referenceEntity).toBe("e1")
    // Should find e2 as similar (excluding self)
    expect((content.results as unknown[]).length).toBeGreaterThan(0)
  })

  it("embeds on-the-fly for entity without embedding", async () => {
    const container = createTestContainer()
    await container.graphStore.upsertEntity("org-1", {
      id: "e1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "testFn", file_path: "test.ts",
      signature: "() => void", body: "function testFn() {}",
    })
    // No embedding stored — should embed on-the-fly
    const result = await handleFindSimilar({ entityKey: "e1" }, mockCtx, container)
    expect(result.isError).toBeUndefined()
  })

  it("returns error for non-existent entity without embedding", async () => {
    const container = createTestContainer()
    const result = await handleFindSimilar({ entityKey: "nonexistent" }, mockCtx, container)
    expect(result.isError).toBe(true)
  })
})
