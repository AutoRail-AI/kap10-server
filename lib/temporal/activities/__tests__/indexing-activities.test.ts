/**
 * Unit tests for Temporal indexing activities (Phase 1).
 *
 * Activities are plain async functions that use getContainer().
 * We mock the container module to inject test fakes.
 *
 * Note: Full workflow replay tests require @temporalio/testing (not installed).
 * These tests verify individual activity behavior and the activity → container contract.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createTestContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"

// Mock the container module so activities get test fakes
vi.mock("@/lib/di/container", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/di/container")>()
  let testContainer: Container | null = null
  return {
    ...original,
    getContainer: () => {
      if (!testContainer) {
        testContainer = original.createTestContainer()
      }
      return testContainer
    },
    // Expose setter for tests to inject custom containers
    __setTestContainer: (c: Container) => {
      testContainer = c
    },
    __resetTestContainer: () => {
      testContainer = null
    },
  }
})

// Mock @temporalio/activity heartbeat so it doesn't throw outside a workflow
vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
}))

// Import after mock is set up
const { prepareWorkspace, runSCIP, parseRest } = await import("../indexing-heavy")
const { writeToArango, updateRepoError, deleteRepoData } = await import("../indexing-light")
const { __resetTestContainer } = await import("@/lib/di/container") as typeof import("@/lib/di/container") & {
  __resetTestContainer: () => void
}

describe("indexing-heavy activities", () => {
  beforeEach(() => {
    __resetTestContainer()
  })

  describe("prepareWorkspace", () => {
    it("returns workspace path based on orgId and repoId", async () => {
      const result = await prepareWorkspace({
        orgId: "org-1",
        repoId: "repo-1",
        installationId: 123,
        cloneUrl: "https://github.com/test/repo.git",
        defaultBranch: "main",
      })

      expect(result.workspacePath).toBe("/data/workspaces/org-1/repo-1")
    })

    it("calls gitHost.cloneRepo with correct arguments", async () => {
      const container = createTestContainer()
      const cloneSpy = vi.spyOn(container.gitHost, "cloneRepo")
      const { __setTestContainer } = await import("@/lib/di/container") as typeof import("@/lib/di/container") & {
        __setTestContainer: (c: Container) => void
      }
      __setTestContainer(container)

      await prepareWorkspace({
        orgId: "org-1",
        repoId: "repo-1",
        installationId: 456,
        cloneUrl: "https://github.com/test/repo.git",
        defaultBranch: "develop",
      })

      expect(cloneSpy).toHaveBeenCalledWith(
        "https://github.com/test/repo.git",
        "/data/workspaces/org-1/repo-1",
        expect.objectContaining({ ref: "develop", installationId: 456 })
      )
    })

    it("returns languages and workspaceRoots", async () => {
      const result = await prepareWorkspace({
        orgId: "org-1",
        repoId: "repo-1",
        installationId: 123,
        cloneUrl: "https://github.com/test/repo.git",
        defaultBranch: "main",
      })

      // The workspace path doesn't exist on disk, so scanner returns empty
      expect(result.languages).toBeDefined()
      expect(result.workspaceRoots).toBeDefined()
      expect(Array.isArray(result.languages)).toBe(true)
      expect(Array.isArray(result.workspaceRoots)).toBe(true)
    })
  })

  describe("runSCIP", () => {
    it("returns entities, edges, and coveredFiles (empty for non-existent workspace)", async () => {
      const result = await runSCIP({
        workspacePath: "/data/workspaces/org-1/repo-1",
        orgId: "org-1",
        repoId: "repo-1",
        languages: ["typescript"],
        workspaceRoots: ["."],
      })

      expect(result).toHaveProperty("entities")
      expect(result).toHaveProperty("edges")
      expect(result).toHaveProperty("coveredFiles")
      expect(Array.isArray(result.entities)).toBe(true)
      expect(Array.isArray(result.edges)).toBe(true)
      expect(Array.isArray(result.coveredFiles)).toBe(true)
    })
  })

  describe("parseRest", () => {
    it("returns extra entities and edges (empty for non-existent workspace)", async () => {
      const result = await parseRest({
        workspacePath: "/data/workspaces/org-1/repo-1",
        orgId: "org-1",
        repoId: "repo-1",
        coveredFiles: [],
      })

      expect(result).toHaveProperty("extraEntities")
      expect(result).toHaveProperty("extraEdges")
      expect(Array.isArray(result.extraEntities)).toBe(true)
      expect(Array.isArray(result.extraEdges)).toBe(true)
    })
  })
})

describe("indexing-light activities", () => {
  beforeEach(() => {
    __resetTestContainer()
  })

  describe("writeToArango", () => {
    it("writes entities and edges via graphStore and updates repo status", async () => {
      const container = createTestContainer()
      const bulkEntitiesSpy = vi.spyOn(container.graphStore, "bulkUpsertEntities")
      const bulkEdgesSpy = vi.spyOn(container.graphStore, "bulkUpsertEdges")
      const updateStatusSpy = vi.spyOn(container.relationalStore, "updateRepoStatus")

      // Pre-create a repo so updateRepoStatus finds it
      await container.relationalStore.createRepo({
        organizationId: "org-1",
        name: "test-repo",
        fullName: "org/test-repo",
        provider: "github",
        providerId: "123",
      })
      const repos = await container.relationalStore.getRepos("org-1")
      const repoId = repos[0]!.id

      const { __setTestContainer } = await import("@/lib/di/container") as typeof import("@/lib/di/container") & {
        __setTestContainer: (c: Container) => void
      }
      __setTestContainer(container)

      const entities = [
        { id: "e1", org_id: "org-1", repo_id: repoId, kind: "function", name: "foo", file_path: "src/a.ts" },
        { id: "e2", org_id: "org-1", repo_id: repoId, kind: "class", name: "Bar", file_path: "src/b.ts" },
      ]
      const edges = [
        { _from: "functions/e1", _to: "classes/e2", org_id: "org-1", repo_id: repoId, kind: "calls" },
      ]

      const result = await writeToArango({
        orgId: "org-1",
        repoId,
        entities,
        edges,
        fileCount: 2,
        functionCount: 1,
        classCount: 1,
      })

      expect(result.fileCount).toBe(2)
      expect(result.functionCount).toBe(1)
      expect(result.classCount).toBe(1)
      // entitiesWritten includes file entities generated by writeToArango
      expect(result.entitiesWritten).toBeGreaterThanOrEqual(2)

      expect(bulkEntitiesSpy).toHaveBeenCalled()
      expect(bulkEdgesSpy).toHaveBeenCalled()
      expect(updateStatusSpy).toHaveBeenCalledWith(repoId, expect.objectContaining({
        status: "ready",
        progress: 100,
        fileCount: 2,
        functionCount: 1,
        classCount: 1,
      }))
    })

    it("skips bulk operations when entities and edges are empty", async () => {
      const container = createTestContainer()
      const bulkEntitiesSpy = vi.spyOn(container.graphStore, "bulkUpsertEntities")
      const bulkEdgesSpy = vi.spyOn(container.graphStore, "bulkUpsertEdges")

      const { __setTestContainer } = await import("@/lib/di/container") as typeof import("@/lib/di/container") & {
        __setTestContainer: (c: Container) => void
      }
      __setTestContainer(container)

      const result = await writeToArango({
        orgId: "org-1",
        repoId: "repo-1",
        entities: [],
        edges: [],
        fileCount: 0,
        functionCount: 0,
        classCount: 0,
      })

      expect(result.entitiesWritten).toBe(0)
      expect(result.edgesWritten).toBe(0)
      expect(bulkEntitiesSpy).not.toHaveBeenCalled()
      expect(bulkEdgesSpy).not.toHaveBeenCalled()
    })
  })

  describe("updateRepoError", () => {
    it("sets repo status to error with message", async () => {
      const container = createTestContainer()
      const updateSpy = vi.spyOn(container.relationalStore, "updateRepoStatus")

      const { __setTestContainer } = await import("@/lib/di/container") as typeof import("@/lib/di/container") & {
        __setTestContainer: (c: Container) => void
      }
      __setTestContainer(container)

      await updateRepoError("repo-1", "SCIP indexer OOM")

      expect(updateSpy).toHaveBeenCalledWith("repo-1", {
        status: "error",
        errorMessage: "SCIP indexer OOM",
      })
    })
  })

  describe("deleteRepoData", () => {
    it("deletes data from graphStore and relationalStore", async () => {
      const container = createTestContainer()
      const graphDeleteSpy = vi.spyOn(container.graphStore, "deleteRepoData")
      const repoDeleteSpy = vi.spyOn(container.relationalStore, "deleteRepo")

      const { __setTestContainer } = await import("@/lib/di/container") as typeof import("@/lib/di/container") & {
        __setTestContainer: (c: Container) => void
      }
      __setTestContainer(container)

      await deleteRepoData({ orgId: "org-1", repoId: "repo-1" })

      expect(graphDeleteSpy).toHaveBeenCalledWith("org-1", "repo-1")
      expect(repoDeleteSpy).toHaveBeenCalledWith("repo-1")
    })
  })
})
