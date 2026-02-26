import { beforeEach, describe, expect, it } from "vitest"
import { InMemoryGraphStore } from "@/lib/di/fakes"
import { repairEdges } from "@/lib/indexer/edge-repair"
import type { EntityDiff, EntityDoc } from "@/lib/ports/types"

function makeEntity(id: string): EntityDoc {
  return {
    id,
    org_id: "org-1",
    repo_id: "repo-1",
    kind: "function",
    name: id,
    file_path: "src/index.ts",
  }
}

function emptyDiff(): EntityDiff {
  return { added: [], updated: [], deleted: [] }
}

describe("repairEdges", () => {
  let graphStore: InMemoryGraphStore

  beforeEach(() => {
    graphStore = new InMemoryGraphStore()
  })

  it("returns zero counts when diff is empty", async () => {
    const result = await repairEdges("org-1", "repo-1", emptyDiff(), graphStore)
    expect(result.edgesCreated).toBe(0)
    expect(result.edgesDeleted).toBe(0)
  })

  it("deletes edges for removed entities", async () => {
    const entityA = makeEntity("a")
    const entityB = makeEntity("b")
    const entityC = makeEntity("c")

    await graphStore.upsertEntity("org-1", entityA)
    await graphStore.upsertEntity("org-1", entityB)
    await graphStore.upsertEntity("org-1", entityC)

    // a -> b, b -> c
    await graphStore.upsertEdge("org-1", {
      _from: "functions/a",
      _to: "functions/b",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })
    await graphStore.upsertEdge("org-1", {
      _from: "functions/b",
      _to: "functions/c",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })

    // Delete entity b (should remove both edges referencing b)
    const diff: EntityDiff = {
      added: [],
      updated: [],
      deleted: [entityB],
    }

    const result = await repairEdges("org-1", "repo-1", diff, graphStore)
    expect(result.edgesDeleted).toBeGreaterThan(0)
  })

  it("handles diff with only added entities", async () => {
    const newEntity = makeEntity("new-func")
    const diff: EntityDiff = {
      added: [newEntity],
      updated: [],
      deleted: [],
    }

    const result = await repairEdges("org-1", "repo-1", diff, graphStore)
    // Added entities don't create edges automatically
    expect(result.edgesCreated).toBe(0)
    expect(result.edgesDeleted).toBe(0)
  })
})
