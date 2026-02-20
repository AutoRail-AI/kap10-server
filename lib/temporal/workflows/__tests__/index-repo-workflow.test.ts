/**
 * P1-TEST-09: Workflow replay / logic test for indexRepoWorkflow.
 *
 * Since @temporalio/testing is not installed, we test the workflow logic
 * by mocking the Temporal workflow APIs (proxyActivities, defineQuery, setHandler).
 * This verifies:
 * - Activity call order (prepareWorkspace → runSCIP → parseRest → writeToArango)
 * - Progress updates at each stage (0% → 25% → 50% → 75% → 100%)
 * - Error handling: activity failure → updateRepoError called → error re-thrown
 * - Entity/edge merging from SCIP + parseRest
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// Track activity calls and progress
let progressHandler: (() => number) | null = null
const activityCalls: { name: string; args: unknown[] }[] = []

// Mock activity implementations
const mockPrepareWorkspace = vi.fn()
const mockRunSCIP = vi.fn()
const mockParseRest = vi.fn()
const mockWriteToArango = vi.fn()
const mockUpdateRepoError = vi.fn()

// Mock @temporalio/workflow
vi.mock("@temporalio/workflow", () => ({
  defineQuery: vi.fn((_name: string) => Symbol("query")),
  setHandler: vi.fn((_query: unknown, handler: () => number) => {
    progressHandler = handler
  }),
  startChild: vi.fn(async () => ({ workflowId: "embed-test", runId: "run-test" })),
  ParentClosePolicy: { ABANDON: "ABANDON", TERMINATE: "TERMINATE", REQUEST_CANCEL: "REQUEST_CANCEL" },
  proxyActivities: vi.fn((_opts: unknown) => {
    // Return a proxy that captures calls
    return new Proxy(
      {},
      {
        get(_target, prop: string) {
          switch (prop) {
            case "prepareWorkspace":
              return (...args: unknown[]) => {
                activityCalls.push({ name: "prepareWorkspace", args })
                return mockPrepareWorkspace(...args)
              }
            case "runSCIP":
              return (...args: unknown[]) => {
                activityCalls.push({ name: "runSCIP", args })
                return mockRunSCIP(...args)
              }
            case "parseRest":
              return (...args: unknown[]) => {
                activityCalls.push({ name: "parseRest", args })
                return mockParseRest(...args)
              }
            case "writeToArango":
              return (...args: unknown[]) => {
                activityCalls.push({ name: "writeToArango", args })
                return mockWriteToArango(...args)
              }
            case "updateRepoError":
              return (...args: unknown[]) => {
                activityCalls.push({ name: "updateRepoError", args })
                return mockUpdateRepoError(...args)
              }
            default:
              return undefined
          }
        },
      },
    )
  }),
}))

// Mock the embed-repo workflow module (imported by index-repo)
vi.mock("../embed-repo", () => ({
  embedRepoWorkflow: vi.fn(),
}))

// Import workflow after mocks are set up
const { indexRepoWorkflow } = await import("../index-repo")

const DEFAULT_INPUT = {
  orgId: "org-1",
  repoId: "repo-1",
  installationId: 123,
  cloneUrl: "https://github.com/test/repo.git",
  defaultBranch: "main",
}

describe("indexRepoWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activityCalls.length = 0
    progressHandler = null

    // Default mock returns
    mockPrepareWorkspace.mockResolvedValue({
      workspacePath: "/data/workspaces/org-1/repo-1",
      languages: ["typescript"],
      workspaceRoots: ["."],
    })

    mockRunSCIP.mockResolvedValue({
      entities: [
        { id: "e1", org_id: "org-1", repo_id: "repo-1", kind: "function", name: "hello", file_path: "src/index.ts" },
      ],
      edges: [
        { _from: "functions/e1", _to: "functions/e2", org_id: "org-1", repo_id: "repo-1", kind: "calls" },
      ],
      coveredFiles: ["src/index.ts"],
    })

    mockParseRest.mockResolvedValue({
      extraEntities: [
        { id: "e3", org_id: "org-1", repo_id: "repo-1", kind: "class", name: "Helper", file_path: "src/helper.ts" },
      ],
      extraEdges: [],
    })

    mockWriteToArango.mockResolvedValue({
      entitiesWritten: 2,
      edgesWritten: 1,
      fileCount: 2,
      functionCount: 1,
      classCount: 1,
    })

    mockUpdateRepoError.mockResolvedValue(undefined)
  })

  it("calls activities in correct order", async () => {
    await indexRepoWorkflow(DEFAULT_INPUT)

    expect(activityCalls.map((c) => c.name)).toEqual([
      "prepareWorkspace",
      "runSCIP",
      "parseRest",
      "writeToArango",
    ])
  })

  it("passes correct arguments to prepareWorkspace", async () => {
    await indexRepoWorkflow(DEFAULT_INPUT)

    expect(mockPrepareWorkspace).toHaveBeenCalledWith({
      orgId: "org-1",
      repoId: "repo-1",
      installationId: 123,
      cloneUrl: "https://github.com/test/repo.git",
      defaultBranch: "main",
    })
  })

  it("passes workspace info from prepareWorkspace to runSCIP", async () => {
    await indexRepoWorkflow(DEFAULT_INPUT)

    expect(mockRunSCIP).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: "/data/workspaces/org-1/repo-1",
        orgId: "org-1",
        repoId: "repo-1",
        languages: ["typescript"],
        workspaceRoots: ["."],
      }),
    )
  })

  it("passes coveredFiles from runSCIP to parseRest", async () => {
    await indexRepoWorkflow(DEFAULT_INPUT)

    expect(mockParseRest).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: "/data/workspaces/org-1/repo-1",
        orgId: "org-1",
        repoId: "repo-1",
        coveredFiles: ["src/index.ts"],
      }),
    )
  })

  it("merges SCIP and parseRest entities/edges into writeToArango", async () => {
    await indexRepoWorkflow(DEFAULT_INPUT)

    const writeCall = mockWriteToArango.mock.calls[0]![0] as {
      entities: { id: string }[]
      edges: { _from: string }[]
    }

    // Should have entities from both SCIP (e1) and parseRest (e3)
    const entityIds = writeCall.entities.map((e: { id: string }) => e.id)
    expect(entityIds).toContain("e1")
    expect(entityIds).toContain("e3")

    // Should have edges from SCIP
    expect(writeCall.edges.length).toBeGreaterThanOrEqual(1)
  })

  it("computes fileCount, functionCount, classCount from merged entities", async () => {
    await indexRepoWorkflow(DEFAULT_INPUT)

    const writeCall = mockWriteToArango.mock.calls[0]![0] as {
      fileCount: number
      functionCount: number
      classCount: number
    }

    expect(writeCall.fileCount).toBe(2) // src/index.ts + src/helper.ts
    expect(writeCall.functionCount).toBe(1) // hello
    expect(writeCall.classCount).toBe(1) // Helper
  })

  it("updates progress at each stage", async () => {
    // Track progress values captured after each activity
    const progressValues: number[] = []

    // Override mocks to capture progress after each step
    mockPrepareWorkspace.mockImplementation(async () => {
      const result = {
        workspacePath: "/data/workspaces/org-1/repo-1",
        languages: ["typescript"],
        workspaceRoots: ["."],
      }
      return result
    })

    mockRunSCIP.mockImplementation(async () => {
      // Progress should be 25 after prepareWorkspace
      if (progressHandler) progressValues.push(progressHandler())
      return {
        entities: [],
        edges: [],
        coveredFiles: [],
      }
    })

    mockParseRest.mockImplementation(async () => {
      // Progress should be 50 after runSCIP
      if (progressHandler) progressValues.push(progressHandler())
      return { extraEntities: [], extraEdges: [] }
    })

    mockWriteToArango.mockImplementation(async () => {
      // Progress should be 75 after parseRest
      if (progressHandler) progressValues.push(progressHandler())
      return {
        entitiesWritten: 0,
        edgesWritten: 0,
        fileCount: 0,
        functionCount: 0,
        classCount: 0,
      }
    })

    await indexRepoWorkflow(DEFAULT_INPUT)

    // Check progress after last step
    if (progressHandler) progressValues.push(progressHandler())

    // Progress captures: inside runSCIP=25, inside parseRest=50, inside writeToArango=75, final=100
    // (95 is set briefly between writeToArango and startChild but no callback captures it)
    expect(progressValues).toEqual([25, 50, 75, 100])
  })

  it("calls updateRepoError and re-throws on activity failure", async () => {
    mockRunSCIP.mockRejectedValue(new Error("SCIP OOM killed"))

    await expect(indexRepoWorkflow(DEFAULT_INPUT)).rejects.toThrow("SCIP OOM killed")

    expect(mockUpdateRepoError).toHaveBeenCalledWith("repo-1", "SCIP OOM killed")
  })

  it("calls updateRepoError with stringified error for non-Error throws", async () => {
    mockPrepareWorkspace.mockRejectedValue("disk full")

    await expect(indexRepoWorkflow(DEFAULT_INPUT)).rejects.toThrow()

    expect(mockUpdateRepoError).toHaveBeenCalledWith("repo-1", "disk full")
  })

  it("returns writeToArango result on success", async () => {
    const result = await indexRepoWorkflow(DEFAULT_INPUT)

    expect(result).toEqual({
      entitiesWritten: 2,
      edgesWritten: 1,
      fileCount: 2,
      functionCount: 1,
      classCount: 1,
    })
  })

  it("ensures all entities have org_id and repo_id", async () => {
    // Return entities without org_id/repo_id to test the workflow's merge logic
    mockRunSCIP.mockResolvedValue({
      entities: [
        { id: "e1", kind: "function", name: "foo", file_path: "a.ts" },
      ],
      edges: [],
      coveredFiles: [],
    })
    mockParseRest.mockResolvedValue({
      extraEntities: [
        { id: "e2", kind: "class", name: "Bar", file_path: "b.ts" },
      ],
      extraEdges: [],
    })

    await indexRepoWorkflow(DEFAULT_INPUT)

    const writeCall = mockWriteToArango.mock.calls[0]![0] as {
      entities: { org_id: string; repo_id: string }[]
    }

    for (const entity of writeCall.entities) {
      expect(entity.org_id).toBe("org-1")
      expect(entity.repo_id).toBe("repo-1")
    }
  })
})
