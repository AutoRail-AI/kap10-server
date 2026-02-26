/**
 * Phase 10b TEST-08: Pre-fetch context expansion use case tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock env before imports
vi.mock("@/env.mjs", () => ({
  env: {
    PREFETCH_REDIS_TTL_SECONDS: 300,
    PREFETCH_EXPANSION_HOPS: 2,
  },
}))

import type { Container } from "@/lib/di/container"
import { getPrefetchedContext, prefetchContext } from "../prefetch-context"

function createMockContainer(): Container {
  return {
    graphStore: {
      getEntitiesByFile: vi.fn().mockResolvedValue([
        { id: "fn1", kind: "function", name: "handleAuth", file_path: "src/auth.ts" },
        { id: "fn2", kind: "function", name: "validateToken", file_path: "src/auth.ts" },
      ]),
      getCallersOf: vi.fn().mockResolvedValue([
        { id: "fn3", kind: "function", name: "loginRoute", file_path: "src/routes/login.ts" },
      ]),
      getCalleesOf: vi.fn().mockResolvedValue([
        { id: "fn4", kind: "function", name: "hashPassword", file_path: "src/crypto.ts" },
      ]),
    },
    cacheStore: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    vectorSearch: {
      search: vi.fn().mockResolvedValue([]),
    },
  } as unknown as Container
}

describe("prefetchContext", () => {
  let container: Container

  beforeEach(() => {
    container = createMockContainer()
  })

  it("expands same-file entities", async () => {
    const result = await prefetchContext(container, {
      orgId: "org-1",
      repoId: "repo-1",
      filePath: "src/auth.ts",
    })

    expect(result.filePath).toBe("src/auth.ts")
    expect(result.entities.length).toBeGreaterThan(0)
    expect(result.cachedAt).toBeTruthy()

    // Should include same-file entities
    const sameFile = result.entities.filter((e) => e.relationship === "same_file")
    expect(sameFile.length).toBe(2)
  })

  it("expands callers and callees", async () => {
    const result = await prefetchContext(container, {
      orgId: "org-1",
      repoId: "repo-1",
      filePath: "src/auth.ts",
      entityKey: "fn1",
    })

    const callers = result.entities.filter((e) => e.relationship === "caller")
    const callees = result.entities.filter((e) => e.relationship === "callee")
    expect(callers.length).toBeGreaterThan(0)
    expect(callees.length).toBeGreaterThan(0)
  })

  it("caches result in Redis", async () => {
    await prefetchContext(container, {
      orgId: "org-1",
      repoId: "repo-1",
      filePath: "src/auth.ts",
    })

    expect(container.cacheStore.set).toHaveBeenCalledWith(
      expect.stringContaining("prefetch:ctx:org-1:repo-1:src/auth.ts"),
      expect.objectContaining({ filePath: "src/auth.ts" }),
      300
    )
  })

  it("handles graph query failures gracefully", async () => {
    ;(container.graphStore.getEntitiesByFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB error"))

    const result = await prefetchContext(container, {
      orgId: "org-1",
      repoId: "repo-1",
      filePath: "src/missing.ts",
    })

    expect(result.entities.length).toBe(0)
  })

  it("deduplicates entities", async () => {
    // Make callers return same entity as file entities
    ;(container.graphStore.getCallersOf as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "fn1", kind: "function", name: "handleAuth", file_path: "src/auth.ts" },
    ])

    const result = await prefetchContext(container, {
      orgId: "org-1",
      repoId: "repo-1",
      filePath: "src/auth.ts",
      entityKey: "fn1",
    })

    const fn1Entries = result.entities.filter((e) => e.key === "fn1")
    // fn1 should appear only once (either as caller or same_file, not both)
    expect(fn1Entries.length).toBeLessThanOrEqual(1)
  })
})

describe("getPrefetchedContext", () => {
  it("returns null on cache miss", async () => {
    const container = createMockContainer()
    const result = await getPrefetchedContext(container, "org-1", "repo-1", "src/auth.ts")
    expect(result).toBeNull()
  })

  it("returns cached data on cache hit", async () => {
    const container = createMockContainer()
    const cached = {
      filePath: "src/auth.ts",
      entities: [{ key: "fn1", kind: "function", name: "handleAuth", file_path: "src/auth.ts", relationship: "same_file" }],
      cachedAt: new Date().toISOString(),
    }
    ;(container.cacheStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(cached)

    const result = await getPrefetchedContext(container, "org-1", "repo-1", "src/auth.ts")
    expect(result).toEqual(cached)
  })
})
