/**
 * P5-TEST-08: Reconciliation workflow.
 * Tests orphaned entity detection, broken edge detection, and mismatch reconciliation.
 *
 * The reconciliation workflow is currently a placeholder that returns empty results.
 * These tests exercise the underlying graph store operations that a full reconciliation
 * would use, plus test the workflow contract itself.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { createTestContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"
import type { EntityDoc } from "@/lib/ports/types"

function makeEntity(overrides: Partial<EntityDoc> & { id: string; name: string }): EntityDoc {
  return {
    kind: "function",
    file_path: "src/index.ts",
    start_line: 1,
    end_line: 10,
    org_id: "org-1",
    repo_id: "repo-1",
    ...overrides,
  } as EntityDoc
}

describe("reconciliation — orphaned entity detection", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
  })

  it("detects entities with no edges (orphaned)", async () => {
    // Insert entities: one connected, one orphaned
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-connected", name: "connected" }))
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-orphan", name: "orphan" }))

    // Only fn-connected has edges
    await container.graphStore.upsertEdge("org-1", {
      _from: "functions/fn-connected",
      _to: "functions/fn-other",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })

    // Query all entities
    const allEntities = await container.graphStore.getAllEntities("org-1", "repo-1")
    expect(allEntities).toHaveLength(2)

    // Find entities that have no edges referencing them
    const allEdges = await container.graphStore.getAllEdges("org-1", "repo-1")
    const referencedKeys = new Set<string>()
    for (const edge of allEdges) {
      const fromKey = edge._from.split("/").pop()!
      const toKey = edge._to.split("/").pop()!
      referencedKeys.add(fromKey)
      referencedKeys.add(toKey)
    }

    const orphans = allEntities.filter((e) => !referencedKeys.has(e.id))
    expect(orphans).toHaveLength(1)
    expect(orphans[0]!.id).toBe("fn-orphan")
    expect(orphans[0]!.name).toBe("orphan")
  })

  it("returns no orphans when all entities have edges", async () => {
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-a", name: "alpha" }))
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-b", name: "beta" }))

    await container.graphStore.upsertEdge("org-1", {
      _from: "functions/fn-a",
      _to: "functions/fn-b",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })

    const allEntities = await container.graphStore.getAllEntities("org-1", "repo-1")
    const allEdges = await container.graphStore.getAllEdges("org-1", "repo-1")
    const referencedKeys = new Set<string>()
    for (const edge of allEdges) {
      referencedKeys.add(edge._from.split("/").pop()!)
      referencedKeys.add(edge._to.split("/").pop()!)
    }

    const orphans = allEntities.filter((e) => !referencedKeys.has(e.id))
    expect(orphans).toHaveLength(0)
  })
})

describe("reconciliation — broken edge detection", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
  })

  it("detects edges pointing to deleted entities", async () => {
    // Insert entity A but not entity B
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-a", name: "alpha" }))

    // Create edge from A to B (B does not exist)
    await container.graphStore.upsertEdge("org-1", {
      _from: "functions/fn-a",
      _to: "functions/fn-deleted",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })

    // Find broken edges using findBrokenEdges
    const brokenEdges = await container.graphStore.findBrokenEdges("org-1", "repo-1", ["fn-deleted"])
    expect(brokenEdges).toHaveLength(1)
    expect(brokenEdges[0]!._to).toContain("fn-deleted")
  })

  it("detects edges from deleted entities", async () => {
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-target", name: "target" }))

    // Create edge from a deleted entity to target
    await container.graphStore.upsertEdge("org-1", {
      _from: "functions/fn-gone",
      _to: "functions/fn-target",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })

    const brokenEdges = await container.graphStore.findBrokenEdges("org-1", "repo-1", ["fn-gone"])
    expect(brokenEdges).toHaveLength(1)
    expect(brokenEdges[0]!._from).toContain("fn-gone")
  })

  it("returns no broken edges when all referenced entities exist", async () => {
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-a", name: "alpha" }))
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-b", name: "beta" }))

    await container.graphStore.upsertEdge("org-1", {
      _from: "functions/fn-a",
      _to: "functions/fn-b",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })

    // No deleted keys — no broken edges
    const brokenEdges = await container.graphStore.findBrokenEdges("org-1", "repo-1", [])
    expect(brokenEdges).toHaveLength(0)
  })

  it("cleans up broken edges via batchDeleteEdgesByEntity", async () => {
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-a", name: "alpha" }))
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-b", name: "beta" }))

    await container.graphStore.upsertEdge("org-1", {
      _from: "functions/fn-a",
      _to: "functions/fn-deleted",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })
    await container.graphStore.upsertEdge("org-1", {
      _from: "functions/fn-a",
      _to: "functions/fn-b",
      kind: "calls",
      org_id: "org-1",
      repo_id: "repo-1",
    })

    // Delete edges referencing fn-deleted
    await container.graphStore.batchDeleteEdgesByEntity("org-1", ["fn-deleted"])

    const remainingEdges = await container.graphStore.getAllEdges("org-1", "repo-1")
    expect(remainingEdges).toHaveLength(1)
    expect(remainingEdges[0]!._to).toContain("fn-b")
  })
})

describe("reconciliation — mismatch detection", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
  })

  it("detects when graph entities exist that are not in the vector store", async () => {
    // Insert entities into graph store
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-1", name: "func1" }))
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-2", name: "func2" }))
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-3", name: "func3" }))

    // Only embed fn-1 and fn-2 in vector store
    const embedding = new Array<number>(768).fill(0.1)
    await container.vectorSearch.upsert(
      ["fn-1", "fn-2"],
      [embedding, embedding],
      [
        { orgId: "org-1", repoId: "repo-1" },
        { orgId: "org-1", repoId: "repo-1" },
      ]
    )

    // Check which graph entities are missing from vector store
    const allEntities = await container.graphStore.getAllEntities("org-1", "repo-1")
    const missingEmbeddings: string[] = []
    for (const entity of allEntities) {
      const emb = await container.vectorSearch.getEmbedding("repo-1", entity.id)
      if (!emb) {
        missingEmbeddings.push(entity.id)
      }
    }

    expect(missingEmbeddings).toEqual(["fn-3"])
  })

  it("detects orphaned vector embeddings that have no matching graph entity", async () => {
    // Only fn-1 exists in graph
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-1", name: "func1" }))

    // But vector store has fn-1 and fn-stale
    const embedding = new Array<number>(768).fill(0.1)
    await container.vectorSearch.upsert(
      ["fn-1", "fn-stale"],
      [embedding, embedding],
      [
        { orgId: "org-1", repoId: "repo-1" },
        { orgId: "org-1", repoId: "repo-1" },
      ]
    )

    // Use deleteOrphaned to clean up
    const currentEntityKeys = (await container.graphStore.getAllEntities("org-1", "repo-1")).map((e) => e.id)
    const deleted = await container.vectorSearch.deleteOrphaned("repo-1", currentEntityKeys)

    expect(deleted).toBe(1) // fn-stale was deleted
  })

  it("reconciles by removing orphaned entities from graph store", async () => {
    // Set up: entity exists in graph but belongs to a file that was deleted
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({ id: "fn-stale", name: "staleFunc", file_path: "src/deleted-file.ts" })
    )
    await container.graphStore.upsertEntity(
      "org-1",
      makeEntity({ id: "fn-valid", name: "validFunc", file_path: "src/valid.ts" })
    )

    // Simulating reconciliation: we know the valid file paths
    const validFilePaths = new Set(["src/valid.ts"])

    const allEntities = await container.graphStore.getAllEntities("org-1", "repo-1")
    const staleKeys = allEntities
      .filter((e) => !validFilePaths.has(e.file_path))
      .map((e) => e.id)

    expect(staleKeys).toEqual(["fn-stale"])

    // Clean up stale entities
    await container.graphStore.batchDeleteEntities("org-1", staleKeys)

    const remaining = await container.graphStore.getAllEntities("org-1", "repo-1")
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).toBe("fn-valid")
  })
})

describe("reconciliationWorkflow — contract", () => {
  it("returns the expected result shape", async () => {
    // The current workflow is a placeholder, but we verify the contract
    const { reconciliationWorkflow } = await import("@/lib/temporal/workflows/reconciliation")

    const result = await reconciliationWorkflow({ orgId: "org-1" })

    expect(result).toHaveProperty("reposChecked")
    expect(result).toHaveProperty("reposTriggered")
    expect(result).toHaveProperty("errors")
    expect(typeof result.reposChecked).toBe("number")
    expect(typeof result.reposTriggered).toBe("number")
    expect(Array.isArray(result.errors)).toBe(true)
  })
})
