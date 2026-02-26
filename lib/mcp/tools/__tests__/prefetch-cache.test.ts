/**
 * Phase 10b TEST-09: Pre-fetch cache hit in semantic search tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the prefetch context module
vi.mock("@/lib/use-cases/prefetch-context", () => ({
  getPrefetchedContext: vi.fn(),
}))

// Mock the hybrid search module
vi.mock("@/lib/embeddings/hybrid-search", () => ({
  hybridSearch: vi.fn().mockResolvedValue({
    results: [
      {
        entityKey: "fn-search-result",
        entityName: "searchResult",
        entityType: "function",
        filePath: "src/search.ts",
        lineStart: 1,
        signature: "searchResult()",
        score: 0.95,
        callers: [],
        callees: [],
      },
    ],
    meta: { degraded: false },
  }),
}))

import type { Container } from "@/lib/di/container"
import { getPrefetchedContext } from "@/lib/use-cases/prefetch-context"
import type { McpAuthContext } from "../../auth"
import { handleSemanticSearch } from "../semantic"

function createMockContainer(): Container {
  return {} as Container
}

function createMockCtx(): McpAuthContext {
  return {
    orgId: "org-1",
    repoId: "repo-1",
    userId: "user-1",
    scopes: ["mcp:read"],
    workspaceId: undefined,
    sessionId: undefined,
  } as unknown as McpAuthContext
}

describe("semantic_search prefetch cache", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns prefetched results when cache hit", async () => {
    const mockGetPrefetched = getPrefetchedContext as ReturnType<typeof vi.fn>
    mockGetPrefetched.mockResolvedValue({
      filePath: "auth logic",
      entities: [
        { key: "fn1", kind: "function", name: "handleAuth", file_path: "src/auth.ts", relationship: "same_file" },
        { key: "fn2", kind: "function", name: "validateToken", file_path: "src/auth.ts", relationship: "callee" },
      ],
      cachedAt: new Date().toISOString(),
    })

    const container = createMockContainer()
    const ctx = createMockCtx()
    const result = await handleSemanticSearch({ query: "auth logic" }, ctx, container)

    // Should return prefetched results
    const parsed = JSON.parse(result.content[0]!.text) as { _meta?: { source?: string }; results?: unknown[] }
    expect(parsed._meta?.source).toBe("cloud_prefetched")
    expect(parsed.results).toHaveLength(2)
  })

  it("falls through to normal search on cache miss", async () => {
    const mockGetPrefetched = getPrefetchedContext as ReturnType<typeof vi.fn>
    mockGetPrefetched.mockResolvedValue(null)

    const container = createMockContainer()
    const ctx = createMockCtx()
    const result = await handleSemanticSearch({ query: "auth logic" }, ctx, container)

    // Should use normal search
    const parsed = JSON.parse(result.content[0]!.text) as { results?: unknown[]; _meta?: { source?: string } }
    expect(parsed._meta?.source).toBeUndefined()
    expect(parsed.results).toHaveLength(1) // from hybridSearch mock
  })

  it("falls through on prefetch error", async () => {
    const mockGetPrefetched = getPrefetchedContext as ReturnType<typeof vi.fn>
    mockGetPrefetched.mockRejectedValue(new Error("Cache error"))

    const container = createMockContainer()
    const ctx = createMockCtx()
    const result = await handleSemanticSearch({ query: "auth logic" }, ctx, container)

    // Should use normal search despite error
    const parsed = JSON.parse(result.content[0]!.text) as { results?: unknown[] }
    expect(parsed.results).toHaveLength(1)
  })
})
