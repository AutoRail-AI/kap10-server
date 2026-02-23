/**
 * P1-TEST-09: Workflow replay / logic test for indexRepoWorkflow.
 *
 * Tests the workflow orchestration logic by mocking Temporal APIs.
 * Verifies:
 * - Activity call order (prepareWorkspace → runSCIP → parseRest → finalizeIndexing)
 * - Progress updates at each stage
 * - Error handling: activity failure → updateRepoError called → error re-thrown
 * - Only lightweight data (counts, coveredFiles) crosses Temporal boundary
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

let progressHandler: (() => number) | null = null
const activityCalls: { name: string; args: unknown[] }[] = []

const mockPrepareWorkspace = vi.fn()
const mockRunSCIP = vi.fn()
const mockParseRest = vi.fn()
const mockFinalizeIndexing = vi.fn()
const mockUpdateRepoError = vi.fn()

vi.mock("@temporalio/workflow", () => ({
  defineQuery: vi.fn((_name: string) => Symbol("query")),
  setHandler: vi.fn((_query: unknown, handler: () => number) => {
    progressHandler = handler
  }),
  workflowInfo: vi.fn(() => ({ runId: "run-test-1234" })),
  startChild: vi.fn(async () => ({ workflowId: "embed-test", runId: "run-test" })),
  ParentClosePolicy: { ABANDON: "ABANDON", TERMINATE: "TERMINATE", REQUEST_CANCEL: "REQUEST_CANCEL" },
  proxyActivities: vi.fn((_opts: unknown) => {
    return new Proxy(
      {},
      {
        get(_target, prop: string) {
          const map: Record<string, (...args: unknown[]) => unknown> = {
            prepareWorkspace: (...args: unknown[]) => { activityCalls.push({ name: "prepareWorkspace", args }); return mockPrepareWorkspace(...args) },
            runSCIP: (...args: unknown[]) => { activityCalls.push({ name: "runSCIP", args }); return mockRunSCIP(...args) },
            parseRest: (...args: unknown[]) => { activityCalls.push({ name: "parseRest", args }); return mockParseRest(...args) },
            finalizeIndexing: (...args: unknown[]) => { activityCalls.push({ name: "finalizeIndexing", args }); return mockFinalizeIndexing(...args) },
            updateRepoError: (...args: unknown[]) => { activityCalls.push({ name: "updateRepoError", args }); return mockUpdateRepoError(...args) },
            appendPipelineLog: () => Promise.resolve(),
            archivePipelineLogs: () => Promise.resolve(),
          }
          return map[prop]
        },
      },
    )
  }),
}))

vi.mock("../embed-repo", () => ({ embedRepoWorkflow: vi.fn() }))
vi.mock("../sync-local-graph", () => ({ syncLocalGraphWorkflow: vi.fn() }))
vi.mock("../detect-patterns", () => ({ detectPatternsWorkflow: vi.fn() }))

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

    mockPrepareWorkspace.mockResolvedValue({
      workspacePath: "/data/workspaces/org-1/repo-1",
      languages: ["typescript"],
      workspaceRoots: ["."],
    })

    mockRunSCIP.mockResolvedValue({
      entityCount: 5,
      edgeCount: 3,
      coveredFiles: ["src/index.ts"],
    })

    mockParseRest.mockResolvedValue({
      entityCount: 2,
      edgeCount: 1,
    })

    mockFinalizeIndexing.mockResolvedValue(undefined)
    mockUpdateRepoError.mockResolvedValue(undefined)
  })

  it("calls activities in correct order", async () => {
    await indexRepoWorkflow(DEFAULT_INPUT)

    expect(activityCalls.map((c) => c.name)).toEqual([
      "prepareWorkspace",
      "runSCIP",
      "parseRest",
      "finalizeIndexing",
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

  it("only passes counts to finalizeIndexing (no entity/edge arrays)", async () => {
    await indexRepoWorkflow(DEFAULT_INPUT)

    expect(mockFinalizeIndexing).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        repoId: "repo-1",
      }),
    )
    const call = mockFinalizeIndexing.mock.calls[0]![0] as Record<string, unknown>
    expect(call).not.toHaveProperty("entities")
    expect(call).not.toHaveProperty("edges")
  })

  it("updates progress at each stage", async () => {
    const progressValues: number[] = []

    mockRunSCIP.mockImplementation(async () => {
      if (progressHandler) progressValues.push(progressHandler())
      return { entityCount: 0, edgeCount: 0, coveredFiles: [] }
    })

    mockParseRest.mockImplementation(async () => {
      if (progressHandler) progressValues.push(progressHandler())
      return { entityCount: 0, edgeCount: 0 }
    })

    mockFinalizeIndexing.mockImplementation(async () => {
      if (progressHandler) progressValues.push(progressHandler())
    })

    await indexRepoWorkflow(DEFAULT_INPUT)

    if (progressHandler) progressValues.push(progressHandler())

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

  it("returns aggregated counts on success", async () => {
    const result = await indexRepoWorkflow(DEFAULT_INPUT)

    expect(result).toHaveProperty("entitiesWritten")
    expect(result).toHaveProperty("edgesWritten")
    expect(result).toHaveProperty("fileCount")
  })
})
