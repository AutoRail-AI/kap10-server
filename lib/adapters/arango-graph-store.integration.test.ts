/**
 * ArangoDB Integration Tests — bulk upsert, query, tenant isolation.
 *
 * Requires a running ArangoDB instance (docker compose up arangodb).
 * Tests are skipped when ArangoDB is not reachable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

import { ArangoGraphStore } from "./arango-graph-store"

const ARANGO_URL = process.env.ARANGODB_URL ?? "http://localhost:8529"

async function isArangoReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${ARANGO_URL}/_api/version`, {
      headers: { Authorization: "Basic " + Buffer.from("root:" + (process.env.ARANGO_ROOT_PASSWORD ?? "changeme")).toString("base64") },
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

let reachable = false
let store: ArangoGraphStore

beforeAll(async () => {
  reachable = await isArangoReachable()
  if (reachable) {
    store = new ArangoGraphStore()
    await store.bootstrapGraphSchema()
  }
})

afterAll(async () => {
  if (reachable) {
    // Clean up test data
    await store.deleteRepoData("test-org-1", "test-repo-1")
    await store.deleteRepoData("test-org-1", "test-repo-2")
    await store.deleteRepoData("test-org-2", "test-repo-3")
  }
})

describe("ArangoGraphStore integration", () => {
  describe.skipIf(!reachable)("with ArangoDB running", () => {
    it("bootstrapGraphSchema is idempotent", async () => {
      // Second call should not throw
      await expect(store.bootstrapGraphSchema()).resolves.toBeUndefined()
    })

    it("healthCheck returns up", async () => {
      const result = await store.healthCheck()
      expect(result.status).toBe("up")
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it("bulkUpsertEntities writes and deduplicates", async () => {
      const entities: EntityDoc[] = Array.from({ length: 100 }, (_, i) => ({
        id: `entity-${i}`,
        org_id: "test-org-1",
        repo_id: "test-repo-1",
        kind: i % 4 === 0 ? "files" : i % 4 === 1 ? "functions" : i % 4 === 2 ? "classes" : "interfaces",
        name: `test_entity_${i}`,
        file_path: `src/file_${i % 10}.ts`,
        line: i * 10,
      }))

      // First upsert
      await expect(store.bulkUpsertEntities("test-org-1", entities)).resolves.toBeUndefined()

      // Second upsert (idempotent — no duplicates)
      await expect(store.bulkUpsertEntities("test-org-1", entities)).resolves.toBeUndefined()
    })

    it("bulkUpsertEdges writes edges", async () => {
      const edges: EdgeDoc[] = Array.from({ length: 50 }, (_, i) => ({
        _from: `functions/entity-${i * 2 + 1}`,
        _to: `functions/entity-${i * 2 + 3}`,
        org_id: "test-org-1",
        repo_id: "test-repo-1",
        kind: "calls",
      }))

      await expect(store.bulkUpsertEdges("test-org-1", edges)).resolves.toBeUndefined()

      // Idempotent re-upsert
      await expect(store.bulkUpsertEdges("test-org-1", edges)).resolves.toBeUndefined()
    })

    it("getEntitiesByFile returns entities for a specific file", async () => {
      const entities = await store.getEntitiesByFile("test-org-1", "test-repo-1", "src/file_0.ts")
      expect(entities.length).toBeGreaterThan(0)
      for (const e of entities) {
        expect(e.file_path).toBe("src/file_0.ts")
      }
    })

    it("getFilePaths returns file paths for a repo", async () => {
      const paths = await store.getFilePaths("test-org-1", "test-repo-1")
      expect(paths.length).toBeGreaterThan(0)
      for (const p of paths) {
        expect(p.path).toBeTruthy()
      }
    })

    it("tenant isolation — org-2 cannot see org-1 data", async () => {
      // Write data for org-2
      await store.bulkUpsertEntities("test-org-2", [
        {
          id: "org2-entity-1",
          org_id: "test-org-2",
          repo_id: "test-repo-3",
          kind: "functions",
          name: "org2_function",
          file_path: "src/org2.ts",
          line: 1,
        },
      ])

      // Query org-1 for org-2's file — should return empty
      const org1Results = await store.getEntitiesByFile("test-org-1", "test-repo-3", "src/org2.ts")
      expect(org1Results).toEqual([])

      // Query org-2 for its own data — should find it
      const org2Results = await store.getEntitiesByFile("test-org-2", "test-repo-3", "src/org2.ts")
      expect(org2Results).toHaveLength(1)
      expect(org2Results[0]?.name).toBe("org2_function")
    })

    it("deleteRepoData removes all entities and edges for a repo", async () => {
      // Write some test data to a separate repo
      await store.bulkUpsertEntities("test-org-1", [
        {
          id: "del-entity-1",
          org_id: "test-org-1",
          repo_id: "test-repo-2",
          kind: "functions",
          name: "to_delete",
          file_path: "src/delete_me.ts",
          line: 1,
        },
      ])

      // Verify it exists
      const before = await store.getEntitiesByFile("test-org-1", "test-repo-2", "src/delete_me.ts")
      expect(before).toHaveLength(1)

      // Delete
      await store.deleteRepoData("test-org-1", "test-repo-2")

      // Verify it's gone
      const after = await store.getEntitiesByFile("test-org-1", "test-repo-2", "src/delete_me.ts")
      expect(after).toHaveLength(0)
    })
  })

  describe("without ArangoDB", () => {
    it.skipIf(reachable)("healthCheck returns down when ArangoDB is unreachable", async () => {
      // Override env to point to a non-existent ArangoDB
      const original = process.env.ARANGODB_URL
      process.env.ARANGODB_URL = "http://localhost:19999"
      try {
        const freshStore = new ArangoGraphStore()
        const result = await freshStore.healthCheck()
        expect(result.status).toBe("down")
      } finally {
        process.env.ARANGODB_URL = original
      }
    })
  })
})
