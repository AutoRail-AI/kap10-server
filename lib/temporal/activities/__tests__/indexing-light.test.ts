/**
 * Unit tests for writeToArango, updateRepoError, and deleteRepoData activities.
 *
 * Tests entity hashing, file entity generation, contains edge creation,
 * deduplication, and correct delegation to graphStore / relationalStore.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { entityHash, edgeHash } from "@/lib/indexer/entity-hash"
import type { EntityDoc, EdgeDoc } from "@/lib/ports/types"

// Mock the DI container
const mockBulkUpsertEntities = vi.fn().mockResolvedValue(undefined)
const mockBulkUpsertEdges = vi.fn().mockResolvedValue(undefined)
const mockUpdateRepoStatus = vi.fn().mockResolvedValue(undefined)
const mockDeleteRepoData = vi.fn().mockResolvedValue(undefined)
const mockDeleteRepo = vi.fn().mockResolvedValue(undefined)

vi.mock("@/lib/di/container", () => ({
  getContainer: () => ({
    graphStore: {
      bulkUpsertEntities: mockBulkUpsertEntities,
      bulkUpsertEdges: mockBulkUpsertEdges,
      deleteRepoData: mockDeleteRepoData,
    },
    relationalStore: {
      updateRepoStatus: mockUpdateRepoStatus,
      deleteRepo: mockDeleteRepo,
    },
  }),
}))

const { writeToArango, updateRepoError, deleteRepoData } = await import("../indexing-light")

describe("writeToArango", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("applies entity hashing to entities without IDs", async () => {
    const entities: EntityDoc[] = [
      { id: "", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "hello", file_path: "src/index.ts" },
    ]

    await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities,
      edges: [],
      fileCount: 1,
      functionCount: 1,
      classCount: 0,
    })

    const writtenEntities = mockBulkUpsertEntities.mock.calls[0]![1] as EntityDoc[]
    // The function entity should have a hashed ID (not empty)
    const funcEntity = writtenEntities.find((e) => e.kind === "function")
    expect(funcEntity).toBeDefined()
    expect(funcEntity!.id).toMatch(/^[0-9a-f]{16}$/)
    expect(funcEntity!.id).toBe(entityHash("repo-1", "src/index.ts", "function", "hello", undefined))
  })

  it("preserves existing entity IDs", async () => {
    const entities: EntityDoc[] = [
      { id: "already-hashed-id", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "hello", file_path: "src/index.ts" },
    ]

    await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities,
      edges: [],
      fileCount: 1,
      functionCount: 1,
      classCount: 0,
    })

    const writtenEntities = mockBulkUpsertEntities.mock.calls[0]![1] as EntityDoc[]
    const funcEntity = writtenEntities.find((e) => e.kind === "function")
    expect(funcEntity!.id).toBe("already-hashed-id")
  })

  it("applies edge hashing to all edges", async () => {
    const edges: EdgeDoc[] = [
      { _from: "functions/abc", _to: "functions/def", org_id: "org-1", repo_id: "repo-1", kind: "calls" },
    ]

    await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities: [],
      edges,
      fileCount: 0,
      functionCount: 0,
      classCount: 0,
    })

    const writtenEdges = mockBulkUpsertEdges.mock.calls[0]![1] as (EdgeDoc & { _key: string })[]
    expect(writtenEdges[0]!._key).toBe(edgeHash("functions/abc", "functions/def", "calls"))
    expect(writtenEdges[0]!._key).toMatch(/^[0-9a-f]{16}$/)
  })

  it("generates file entities for each unique file_path", async () => {
    const entities: EntityDoc[] = [
      { id: "e1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "foo", file_path: "src/a.ts" },
      { id: "e2", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "bar", file_path: "src/a.ts" },
      { id: "e3", org_id: "org-1", repo_id: "repo-1", kind: "class", name: "Baz", file_path: "src/b.ts" },
    ]

    await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities,
      edges: [],
      fileCount: 2,
      functionCount: 2,
      classCount: 1,
    })

    const writtenEntities = mockBulkUpsertEntities.mock.calls[0]![1] as EntityDoc[]
    const fileEntities = writtenEntities.filter((e) => e.kind === "file")

    // Should create 2 file entities (src/a.ts, src/b.ts)
    expect(fileEntities).toHaveLength(2)
    expect(fileEntities.map((f) => f.file_path).sort()).toEqual(["src/a.ts", "src/b.ts"])
    expect(fileEntities[0]!.org_id).toBe("org-1")
    expect(fileEntities[0]!.repo_id).toBe("repo-1")
  })

  it("generates contains edges from files to entities", async () => {
    const entities: EntityDoc[] = [
      { id: "e1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "foo", file_path: "src/a.ts" },
      { id: "e2", org_id: "org-1", repo_id: "repo-1", kind: "class", name: "Bar", file_path: "src/a.ts" },
    ]

    await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities,
      edges: [],
      fileCount: 1,
      functionCount: 1,
      classCount: 1,
    })

    const writtenEdges = mockBulkUpsertEdges.mock.calls[0]![1] as EdgeDoc[]
    const containsEdges = writtenEdges.filter((e) => e.kind === "contains")

    // 2 contains edges: file → function, file → class
    expect(containsEdges).toHaveLength(2)

    const fileId = entityHash("repo-1", "src/a.ts", "file", "src/a.ts")
    expect(containsEdges[0]!._from).toBe(`files/${fileId}`)
    expect(containsEdges[0]!._to).toBe("functions/e1") // function → functions collection
    expect(containsEdges[1]!._to).toBe("classes/e2") // class → classes collection
  })

  it("maps entity kinds to correct ArangoDB collections in contains edges", async () => {
    const entities: EntityDoc[] = [
      { id: "e1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "fn", file_path: "a.ts" },
      { id: "e2", org_id: "org-1", repo_id: "repo-1", kind: "method", name: "meth", file_path: "a.ts" },
      { id: "e3", org_id: "org-1", repo_id: "repo-1", kind: "class", name: "Cls", file_path: "a.ts" },
      { id: "e4", org_id: "org-1", repo_id: "repo-1", kind: "interface", name: "Ifc", file_path: "a.ts" },
      { id: "e5", org_id: "org-1", repo_id: "repo-1", kind: "variable", name: "v", file_path: "a.ts" },
      { id: "e6", org_id: "org-1", repo_id: "repo-1", kind: "struct", name: "S", file_path: "a.ts" },
      { id: "e7", org_id: "org-1", repo_id: "repo-1", kind: "type", name: "T", file_path: "a.ts" },
      { id: "e8", org_id: "org-1", repo_id: "repo-1", kind: "decorator", name: "dec", file_path: "a.ts" },
    ]

    await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities,
      edges: [],
      fileCount: 1,
      functionCount: 2,
      classCount: 2,
    })

    const writtenEdges = mockBulkUpsertEdges.mock.calls[0]![1] as EdgeDoc[]
    const containsEdges = writtenEdges.filter((e) => e.kind === "contains")

    const toCollections = containsEdges.map((e) => e._to.split("/")[0])
    expect(toCollections).toEqual([
      "functions",    // function
      "functions",    // method
      "classes",      // class
      "interfaces",   // interface
      "variables",    // variable
      "classes",      // struct
      "variables",    // type
      "functions",    // decorator
    ])
  })

  it("deduplicates entities by id", async () => {
    const entities: EntityDoc[] = [
      { id: "dup1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "foo", file_path: "a.ts" },
      { id: "dup1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "foo", file_path: "a.ts" },
      { id: "dup2", org_id: "org-1", repo_id: "repo-1", kind: "class", name: "Bar", file_path: "a.ts" },
    ]

    await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities,
      edges: [],
      fileCount: 1,
      functionCount: 1,
      classCount: 1,
    })

    const writtenEntities = mockBulkUpsertEntities.mock.calls[0]![1] as EntityDoc[]
    const ids = writtenEntities.map((e) => e.id)
    // Should have 3: dup1, dup2, and the generated file entity
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it("deduplicates edges by from+to+kind", async () => {
    const edges: EdgeDoc[] = [
      { _from: "functions/a", _to: "functions/b", org_id: "org-1", repo_id: "repo-1", kind: "calls" },
      { _from: "functions/a", _to: "functions/b", org_id: "org-1", repo_id: "repo-1", kind: "calls" },
      { _from: "functions/a", _to: "functions/b", org_id: "org-1", repo_id: "repo-1", kind: "imports" },
    ]

    await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities: [],
      edges,
      fileCount: 0,
      functionCount: 0,
      classCount: 0,
    })

    const writtenEdges = mockBulkUpsertEdges.mock.calls[0]![1] as EdgeDoc[]
    // Should have 2: one "calls" and one "imports" (duplicate "calls" removed)
    expect(writtenEdges).toHaveLength(2)
  })

  it("skips bulkUpsert calls when no entities or edges", async () => {
    await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities: [],
      edges: [],
      fileCount: 0,
      functionCount: 0,
      classCount: 0,
    })

    expect(mockBulkUpsertEntities).not.toHaveBeenCalled()
    expect(mockBulkUpsertEdges).not.toHaveBeenCalled()
  })

  it("updates repo status to indexing with correct counts", async () => {
    await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities: [],
      edges: [],
      fileCount: 10,
      functionCount: 25,
      classCount: 5,
    })

    expect(mockUpdateRepoStatus).toHaveBeenCalledWith("repo-1", {
      status: "indexing",
      progress: 90,
      fileCount: 10,
      functionCount: 25,
      classCount: 5,
      errorMessage: null,
    })
  })

  it("returns correct result counts", async () => {
    const entities: EntityDoc[] = [
      { id: "e1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "fn", file_path: "a.ts" },
    ]

    const result = await writeToArango({
      orgId: "org-1",
      repoId: "repo-1",
      entities,
      edges: [],
      fileCount: 1,
      functionCount: 1,
      classCount: 0,
    })

    // 1 function + 1 auto-generated file entity = 2
    expect(result.entitiesWritten).toBe(2)
    expect(result.fileCount).toBe(1)
    expect(result.functionCount).toBe(1)
    expect(result.classCount).toBe(0)
  })
})

describe("updateRepoError", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("updates repo status to error with message", async () => {
    await updateRepoError("repo-1", "SCIP OOM killed")

    expect(mockUpdateRepoStatus).toHaveBeenCalledWith("repo-1", {
      status: "error",
      errorMessage: "SCIP OOM killed",
    })
  })
})

describe("deleteRepoData", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("deletes graph data and relational record", async () => {
    await deleteRepoData({ orgId: "org-1", repoId: "repo-1" })

    expect(mockDeleteRepoData).toHaveBeenCalledWith("org-1", "repo-1")
    expect(mockDeleteRepo).toHaveBeenCalledWith("repo-1")
  })
})
