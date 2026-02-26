import { beforeEach, describe, expect, it } from "vitest"
import { InMemoryGraphStore, InMemoryVectorSearch } from "@/lib/di/fakes"
import { buildCascadeQueue } from "@/lib/indexer/cascade"
import { clearCallerCountCache } from "@/lib/indexer/centrality"
import type { EntityDoc } from "@/lib/ports/types"

// buildCascadeQueue passes "" as orgId to graphStore methods,
// so test entities must use org_id: "" to match the filter.
function makeEntity(id: string, orgId = ""): EntityDoc {
  return {
    id,
    org_id: orgId,
    repo_id: "repo-1",
    kind: "function",
    name: id,
    file_path: "src/index.ts",
  }
}

describe("buildCascadeQueue", () => {
  let graphStore: InMemoryGraphStore
  let _vectorSearch: InMemoryVectorSearch

  beforeEach(() => {
    graphStore = new InMemoryGraphStore()
    _vectorSearch = new InMemoryVectorSearch()
    clearCallerCountCache()
  })

  it("returns empty cascade for entities with no callers", async () => {
    await graphStore.upsertEntity("", makeEntity("e1"))

    const result = await buildCascadeQueue(
      ["e1"],
      graphStore,
      null,
      { maxHops: 2, maxEntities: 50, centralityThreshold: 50, significanceThreshold: 0.3 }
    )

    expect(result.reJustifyQueue).toEqual(["e1"])
    expect(result.cascadeQueue).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })

  it("includes direct callers in cascade queue", async () => {
    const target = makeEntity("target")
    const callerA = makeEntity("callerA")
    const callerB = makeEntity("callerB")

    await graphStore.upsertEntity("", target)
    await graphStore.upsertEntity("", callerA)
    await graphStore.upsertEntity("", callerB)

    await graphStore.upsertEdge("", {
      _from: "functions/callerA",
      _to: "functions/target",
      kind: "calls",
      org_id: "",
      repo_id: "repo-1",
    })
    await graphStore.upsertEdge("", {
      _from: "functions/callerB",
      _to: "functions/target",
      kind: "calls",
      org_id: "",
      repo_id: "repo-1",
    })

    const result = await buildCascadeQueue(
      ["target"],
      graphStore,
      null,
      { maxHops: 2, maxEntities: 50, centralityThreshold: 50, significanceThreshold: 0.3 }
    )

    expect(result.reJustifyQueue).toContain("target")
    expect(result.cascadeQueue).toContain("callerA")
    expect(result.cascadeQueue).toContain("callerB")
  })

  it("respects maxEntities limit", async () => {
    const target = makeEntity("target")
    await graphStore.upsertEntity("", target)

    // Create many callers
    for (let i = 0; i < 10; i++) {
      const caller = makeEntity(`caller${i}`)
      await graphStore.upsertEntity("", caller)
      await graphStore.upsertEdge("", {
        _from: `functions/caller${i}`,
        _to: "functions/target",
        kind: "calls",
        org_id: "",
        repo_id: "repo-1",
      })
    }

    const result = await buildCascadeQueue(
      ["target"],
      graphStore,
      null,
      { maxHops: 2, maxEntities: 4, centralityThreshold: 50, significanceThreshold: 0.3 }
    )

    // reJustifyQueue has ["target"] (1 entry) + cascadeQueue limited
    const total = result.reJustifyQueue.length + result.cascadeQueue.length
    expect(total).toBeLessThanOrEqual(4)
  })

  it("skips hub nodes", async () => {
    const hubEntity = makeEntity("hub")
    await graphStore.upsertEntity("", hubEntity)

    // Create enough callers to make "hub" a hub node (threshold=3)
    for (let i = 0; i < 5; i++) {
      const caller = makeEntity(`hubCaller${i}`)
      await graphStore.upsertEntity("", caller)
      await graphStore.upsertEdge("", {
        _from: `functions/hubCaller${i}`,
        _to: "functions/hub",
        kind: "calls",
        org_id: "",
        repo_id: "repo-1",
      })
    }

    // The changed entity "hub" itself won't be traversed since it has too many callers
    const result = await buildCascadeQueue(
      ["hub"],
      graphStore,
      null,
      { maxHops: 2, maxEntities: 50, centralityThreshold: 3, significanceThreshold: 0.3 }
    )

    // Hub is in reJustifyQueue (it's a changed entity), but it's skipped during traversal
    expect(result.reJustifyQueue).toContain("hub")
    expect(result.skipped).toContain("hub")
    // Callers of hub should NOT appear in cascade queue since hub was skipped
    expect(result.cascadeQueue).toHaveLength(0)
  })
})
