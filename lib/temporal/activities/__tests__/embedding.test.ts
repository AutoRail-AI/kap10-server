import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Container } from "@/lib/di/container"

vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
}))

vi.mock("@/lib/di/container", async () => {
  const actual = await vi.importActual("@/lib/di/container") as Record<string, unknown>
  let testContainer: Container | null = null
  return {
    ...actual,
    getContainer: () => testContainer ?? (actual.createTestContainer as () => Container)(),
    __setTestContainer: (c: Container) => { testContainer = c },
    __resetTestContainer: () => { testContainer = null },
  }
})

const { createTestContainer } = await import("@/lib/di/container") as typeof import("@/lib/di/container") & {
  __setTestContainer: (c: Container) => void
  __resetTestContainer: () => void
}
const { __setTestContainer, __resetTestContainer } = await import("@/lib/di/container") as typeof import("@/lib/di/container") & {
  __setTestContainer: (c: Container) => void
  __resetTestContainer: () => void
}

const {
  fetchEntities,
  buildDocuments,
  buildEmbeddableDocuments,
  generateAndStoreEmbeds,
  fetchFilePaths,
  processAndEmbedBatch,
  deleteOrphanedEmbeddings,
  setEmbeddingStatus,
  setReadyStatus: _setReadyStatus,
  setEmbedFailedStatus,
} = await import("../embedding")

describe("embedding activities", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
    __setTestContainer(container)
  })

  afterEach(() => {
    __resetTestContainer()
  })

  describe("setEmbeddingStatus", () => {
    it("sets repo status to embedding", async () => {
      const repo = await container.relationalStore.createRepo({
        organizationId: "org1",
        name: "test-repo",
        fullName: "user/test-repo",
        provider: "github",
        providerId: "123",
      })
      await setEmbeddingStatus({ orgId: "org1", repoId: repo.id })
      const updated = await container.relationalStore.getRepo("org1", repo.id)
      expect(updated?.status).toBe("embedding")
    })
  })

  describe("fetchFilePaths", () => {
    it("returns file paths for a repo", async () => {
      await container.graphStore.bulkUpsertEntities("org1", [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "fn1", file_path: "src/a.ts" },
        { id: "e2", org_id: "org1", repo_id: "repo1", kind: "class", name: "cls1", file_path: "src/b.ts" },
      ])

      const paths = await fetchFilePaths({ orgId: "org1", repoId: "repo1" })
      expect(paths).toContain("src/a.ts")
      expect(paths).toContain("src/b.ts")
    })
  })

  describe("processAndEmbedBatch", () => {
    it("fetches, builds, embeds, and stores for a batch of files", async () => {
      await container.graphStore.bulkUpsertEntities("org1", [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "validate", file_path: "auth.ts", signature: "(t: string) => bool" },
        { id: "e2", org_id: "org1", repo_id: "repo1", kind: "class", name: "AuthService", file_path: "auth.ts" },
        { id: "e3", org_id: "org1", repo_id: "repo1", kind: "file", name: "auth.ts", file_path: "auth.ts" },
      ])

      const result = await processAndEmbedBatch(
        { orgId: "org1", repoId: "repo1" },
        ["auth.ts"],
        { index: 0, total: 1 },
      )

      expect(result.embeddingsStored).toBe(2)
      expect(result.entityKeys).toHaveLength(2)
      expect(result.entityKeys).toContain("e1")
      expect(result.entityKeys).toContain("e2")
      expect(result.entityKeys).not.toContain("e3") // file entity excluded

      const embedding = await container.vectorSearch.embed(["validate"])
      const searchResults = await container.vectorSearch.search(embedding[0]!, 10, { orgId: "org1", repoId: "repo1" })
      expect(searchResults.length).toBe(2)
    })

    it("returns empty results for files with only non-embeddable entities", async () => {
      await container.graphStore.bulkUpsertEntities("org1", [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "file", name: "index.ts", file_path: "index.ts" },
        { id: "e2", org_id: "org1", repo_id: "repo1", kind: "directory", name: "src", file_path: "src" },
      ])

      const result = await processAndEmbedBatch(
        { orgId: "org1", repoId: "repo1" },
        ["index.ts", "src"],
        { index: 0, total: 1 },
      )

      expect(result.embeddingsStored).toBe(0)
      expect(result.entityKeys).toHaveLength(0)
    })

    it("processes multiple file batches independently", async () => {
      await container.graphStore.bulkUpsertEntities("org1", [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "fn1", file_path: "a.ts" },
        { id: "e2", org_id: "org1", repo_id: "repo1", kind: "function", name: "fn2", file_path: "b.ts" },
      ])

      const batch1 = await processAndEmbedBatch(
        { orgId: "org1", repoId: "repo1" },
        ["a.ts"],
        { index: 0, total: 2 },
      )
      const batch2 = await processAndEmbedBatch(
        { orgId: "org1", repoId: "repo1" },
        ["b.ts"],
        { index: 1, total: 2 },
      )

      expect(batch1.embeddingsStored).toBe(1)
      expect(batch2.embeddingsStored).toBe(1)
      expect(batch1.entityKeys).toEqual(["e1"])
      expect(batch2.entityKeys).toEqual(["e2"])
    })
  })

  describe("buildEmbeddableDocuments (helper)", () => {
    it("builds documents with correct text format", () => {
      const entities = [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "validateJWT", file_path: "auth.ts", signature: "(token: string) => boolean", body: "function validateJWT() {}" },
        { id: "e2", org_id: "org1", repo_id: "repo1", kind: "class", name: "AuthService", file_path: "auth.ts" },
      ] as import("@/lib/ports/types").EntityDoc[]

      const docs = buildEmbeddableDocuments(
        { orgId: "org1", repoId: "repo1" },
        entities,
        new Map(),
      )
      expect(docs).toHaveLength(2)

      const fnDoc = docs.find(d => d.entityKey === "e1")!
      expect(fnDoc.text).toContain("Function: validateJWT")
      expect(fnDoc.text).toContain("File: auth.ts")
      expect(fnDoc.text).toContain("Signature: (token: string) => boolean")
      expect(fnDoc.metadata.entityType).toBe("function")
      expect(fnDoc.metadata.entityName).toBe("validateJWT")
      expect(fnDoc.metadata.filePath).toBe("auth.ts")

      const classDoc = docs.find(d => d.entityKey === "e2")!
      expect(classDoc.text).toContain("Class: AuthService")
    })

    it("skips file entities", () => {
      const entities = [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "file", name: "auth.ts", file_path: "auth.ts" },
        { id: "e2", org_id: "org1", repo_id: "repo1", kind: "function", name: "fn1", file_path: "auth.ts" },
      ] as import("@/lib/ports/types").EntityDoc[]

      const docs = buildEmbeddableDocuments(
        { orgId: "org1", repoId: "repo1" },
        entities,
        new Map(),
      )
      expect(docs).toHaveLength(1)
      expect(docs[0]!.entityKey).toBe("e2")
    })

    it("truncates large bodies", () => {
      const largeBody = "x".repeat(30000)
      const entities = [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "bigFn", file_path: "big.ts", body: largeBody },
      ] as import("@/lib/ports/types").EntityDoc[]

      const docs = buildEmbeddableDocuments(
        { orgId: "org1", repoId: "repo1" },
        entities,
        new Map(),
      )
      expect(docs[0]!.text).toContain("[truncated")
      expect(docs[0]!.text.length).toBeLessThan(largeBody.length)
    })
  })

  describe("fetchEntities (legacy)", () => {
    it("returns all entities for a repo", async () => {
      await container.graphStore.bulkUpsertEntities("org1", [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "fn1", file_path: "a.ts" },
        { id: "e2", org_id: "org1", repo_id: "repo1", kind: "class", name: "cls1", file_path: "a.ts" },
        { id: "e3", org_id: "org1", repo_id: "repo1", kind: "file", name: "a.ts", file_path: "a.ts" },
      ])

      const entities = await fetchEntities({ orgId: "org1", repoId: "repo1" })
      expect(entities.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("buildDocuments (legacy)", () => {
    it("builds documents with correct text format", async () => {
      const entities = [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "validateJWT", file_path: "auth.ts", signature: "(token: string) => boolean", body: "function validateJWT() {}" },
        { id: "e2", org_id: "org1", repo_id: "repo1", kind: "class", name: "AuthService", file_path: "auth.ts" },
      ]

      const docs = await buildDocuments({ orgId: "org1", repoId: "repo1" }, entities)
      expect(docs).toHaveLength(2)

      const fnDoc = docs.find(d => d.entityKey === "e1")!
      expect(fnDoc.text).toContain("Function: validateJWT")
      expect(fnDoc.text).toContain("File: auth.ts")
      expect(fnDoc.text).toContain("Signature: (token: string) => boolean")
      expect(fnDoc.metadata.entityType).toBe("function")
      expect(fnDoc.metadata.entityName).toBe("validateJWT")
      expect(fnDoc.metadata.filePath).toBe("auth.ts")

      const classDoc = docs.find(d => d.entityKey === "e2")!
      expect(classDoc.text).toContain("Class: AuthService")
    })

    it("skips file entities", async () => {
      const entities = [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "file", name: "auth.ts", file_path: "auth.ts" },
        { id: "e2", org_id: "org1", repo_id: "repo1", kind: "function", name: "fn1", file_path: "auth.ts" },
      ]

      const docs = await buildDocuments({ orgId: "org1", repoId: "repo1" }, entities)
      expect(docs).toHaveLength(1)
      expect(docs[0]!.entityKey).toBe("e2")
    })

    it("truncates large bodies", async () => {
      const largeBody = "x".repeat(30000)
      const entities = [
        { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "bigFn", file_path: "big.ts", body: largeBody },
      ]

      const docs = await buildDocuments({ orgId: "org1", repoId: "repo1" }, entities)
      expect(docs[0]!.text).toContain("[truncated")
      expect(docs[0]!.text.length).toBeLessThan(largeBody.length)
    })
  })

  describe("generateAndStoreEmbeds (legacy)", () => {
    it("embeds and stores documents", async () => {
      const docs = [
        { entityKey: "e1", text: "Function: validate", metadata: { orgId: "org1", repoId: "repo1", entityKey: "e1", entityType: "function", entityName: "validate", filePath: "a.ts", textContent: "Function: validate" } },
        { entityKey: "e2", text: "Class: Auth", metadata: { orgId: "org1", repoId: "repo1", entityKey: "e2", entityType: "class", entityName: "Auth", filePath: "a.ts", textContent: "Class: Auth" } },
      ]

      const result = await generateAndStoreEmbeds({ orgId: "org1", repoId: "repo1" }, docs)
      expect(result.embeddingsStored).toBe(2)

      // Verify they're searchable
      const embedding = await container.vectorSearch.embed(["validate function"])
      const searchResults = await container.vectorSearch.search(embedding[0]!, 10, { orgId: "org1", repoId: "repo1" })
      expect(searchResults.length).toBe(2)
    })

    it("handles empty documents", async () => {
      const result = await generateAndStoreEmbeds({ orgId: "org1", repoId: "repo1" }, [])
      expect(result.embeddingsStored).toBe(0)
    })
  })

  describe("deleteOrphanedEmbeddings", () => {
    it("deletes embeddings for removed entities", async () => {
      // Store 3 embeddings
      const embeddings = await container.vectorSearch.embed(["a", "b", "c"])
      await container.vectorSearch.upsert(
        ["e1", "e2", "e3"],
        embeddings,
        [
          { orgId: "org1", repoId: "repo1", entityKey: "e1", entityType: "function", entityName: "fn1", filePath: "a.ts", textContent: "a" },
          { orgId: "org1", repoId: "repo1", entityKey: "e2", entityType: "function", entityName: "fn2", filePath: "a.ts", textContent: "b" },
          { orgId: "org1", repoId: "repo1", entityKey: "e3", entityType: "function", entityName: "fn3", filePath: "a.ts", textContent: "c" },
        ]
      )

      // Delete orphans (e3 is no longer in the graph)
      const result = await deleteOrphanedEmbeddings(
        { orgId: "org1", repoId: "repo1" },
        ["e1", "e2"]
      )
      expect(result.deletedCount).toBe(1) // e3 deleted

      // Verify e3 is gone
      const searchResults = await container.vectorSearch.search(embeddings[2]!, 10, { orgId: "org1", repoId: "repo1" })
      const e3 = searchResults.find(r => r.id === "e3")
      expect(e3).toBeUndefined()
    })
  })

  describe("setEmbedFailedStatus", () => {
    it("sets repo status to embed_failed", async () => {
      const repo = await container.relationalStore.createRepo({
        organizationId: "org1",
        name: "test-repo",
        fullName: "user/test-repo",
        provider: "github",
        providerId: "456",
      })
      await setEmbedFailedStatus(repo.id, "OOM error")
      const updated = await container.relationalStore.getRepo("org1", repo.id)
      expect(updated?.status).toBe("embed_failed")
      expect(updated?.errorMessage).toBe("OOM error")
    })
  })
})
