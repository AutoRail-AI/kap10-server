import { beforeEach, describe, expect, it } from "vitest"
import { InMemoryGraphStore } from "@/lib/di/fakes"
import {
  clearCallerCountCache,
  getInboundCallerCount,
  isHubNode,
} from "@/lib/indexer/centrality"
import type { EntityDoc } from "@/lib/ports/types"

function makeEntity(id: string, orgId = "org-1"): EntityDoc {
  return {
    id,
    org_id: orgId,
    repo_id: "repo-1",
    kind: "function",
    name: id,
    file_path: "src/index.ts",
  }
}

describe("centrality", () => {
  let graphStore: InMemoryGraphStore

  beforeEach(() => {
    graphStore = new InMemoryGraphStore()
    clearCallerCountCache()
  })

  describe("getInboundCallerCount", () => {
    it("returns 0 for entity with no callers", async () => {
      await graphStore.upsertEntity("org-1", makeEntity("target"))
      const count = await getInboundCallerCount("org-1", "target", graphStore)
      expect(count).toBe(0)
    })

    it("returns correct count", async () => {
      const target = makeEntity("target")
      const caller1 = makeEntity("caller1")
      const caller2 = makeEntity("caller2")
      const caller3 = makeEntity("caller3")

      await graphStore.upsertEntity("org-1", target)
      await graphStore.upsertEntity("org-1", caller1)
      await graphStore.upsertEntity("org-1", caller2)
      await graphStore.upsertEntity("org-1", caller3)

      await graphStore.upsertEdge("org-1", {
        _from: "functions/caller1",
        _to: "functions/target",
        kind: "calls",
        org_id: "org-1",
        repo_id: "repo-1",
      })
      await graphStore.upsertEdge("org-1", {
        _from: "functions/caller2",
        _to: "functions/target",
        kind: "calls",
        org_id: "org-1",
        repo_id: "repo-1",
      })
      await graphStore.upsertEdge("org-1", {
        _from: "functions/caller3",
        _to: "functions/target",
        kind: "calls",
        org_id: "org-1",
        repo_id: "repo-1",
      })

      const count = await getInboundCallerCount("org-1", "target", graphStore)
      expect(count).toBe(3)
    })

    it("caches results", async () => {
      const target = makeEntity("cached-target")
      await graphStore.upsertEntity("org-1", target)

      // First call
      const count1 = await getInboundCallerCount("org-1", "cached-target", graphStore)
      expect(count1).toBe(0)

      // Add a caller after caching
      await graphStore.upsertEntity("org-1", makeEntity("late-caller"))
      await graphStore.upsertEdge("org-1", {
        _from: "functions/late-caller",
        _to: "functions/cached-target",
        kind: "calls",
        org_id: "org-1",
        repo_id: "repo-1",
      })

      // Second call should still return cached value (0)
      const count2 = await getInboundCallerCount("org-1", "cached-target", graphStore)
      expect(count2).toBe(0)
    })
  })

  describe("isHubNode", () => {
    it("returns true when count >= threshold", () => {
      expect(isHubNode(50, 50)).toBe(true)
      expect(isHubNode(100, 50)).toBe(true)
    })

    it("returns false when count < threshold", () => {
      expect(isHubNode(49, 50)).toBe(false)
      expect(isHubNode(0, 50)).toBe(false)
      expect(isHubNode(10, 50)).toBe(false)
    })
  })

  describe("clearCallerCountCache", () => {
    it("resets cache", async () => {
      const target = makeEntity("reset-target")
      await graphStore.upsertEntity("org-1", target)

      // Cache a value
      const count1 = await getInboundCallerCount("org-1", "reset-target", graphStore)
      expect(count1).toBe(0)

      // Add a caller
      await graphStore.upsertEntity("org-1", makeEntity("new-caller"))
      await graphStore.upsertEdge("org-1", {
        _from: "functions/new-caller",
        _to: "functions/reset-target",
        kind: "calls",
        org_id: "org-1",
        repo_id: "repo-1",
      })

      // Clear cache and re-fetch
      clearCallerCountCache()
      const count2 = await getInboundCallerCount("org-1", "reset-target", graphStore)
      expect(count2).toBe(1)
    })
  })
})
