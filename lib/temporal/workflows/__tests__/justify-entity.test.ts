/**
 * P4-TEST-10: Workflow test for justifyEntityWorkflow.
 *
 * Verifies:
 * - Activity call ordering: fetchEntitiesAndEdges → loadOntology → justifyBatch → embedJustifications → findEntityCallerIds → storeFeatureAggregations
 * - Returns { justified: false } when no entities exist
 * - Cascade: re-justifies callers via findEntityCallerIds
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const activityCalls: { name: string; args: unknown[] }[] = []

const mockFetchEntitiesAndEdges = vi.fn()
const mockLoadOntology = vi.fn()
const mockJustifyBatch = vi.fn()
const mockStoreFeatureAggregations = vi.fn()
const mockEmbedJustifications = vi.fn()
const mockFindEntityCallerIds = vi.fn()

vi.mock("@temporalio/workflow", () => ({
  defineQuery: vi.fn((_name: string) => Symbol("query")),
  setHandler: vi.fn(),
  startChild: vi.fn(async () => ({ workflowId: "test", runId: "run-test" })),
  ParentClosePolicy: { ABANDON: "ABANDON" },
  proxyActivities: vi.fn((_opts: unknown) => {
    return new Proxy(
      {},
      {
        get(_target, prop: string) {
          const fns: Record<string, (...args: unknown[]) => unknown> = {
            fetchEntitiesAndEdges: mockFetchEntitiesAndEdges,
            loadOntology: mockLoadOntology,
            justifyBatch: mockJustifyBatch,
            storeFeatureAggregations: mockStoreFeatureAggregations,
            embedJustifications: mockEmbedJustifications,
            findEntityCallerIds: mockFindEntityCallerIds,
          }
          const fn = fns[prop]
          if (fn) {
            return (...args: unknown[]) => {
              activityCalls.push({ name: prop, args })
              return fn(...args)
            }
          }
          return vi.fn()
        },
      }
    )
  }),
}))

describe("justifyEntityWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activityCalls.length = 0
  })

  it("returns justified=false when no entities exist", async () => {
    mockFetchEntitiesAndEdges.mockResolvedValue({ entityCount: 0, edgeCount: 0 })

    const { justifyEntityWorkflow } = await import("../justify-entity")
    const result = await justifyEntityWorkflow({
      orgId: "org1",
      repoId: "repo1",
      entityId: "nonexistent",
    })

    expect(result.justified).toBe(false)
    expect(result.cascadeCount).toBe(0)
  })

  it("justifies entity and stores results", async () => {
    mockFetchEntitiesAndEdges.mockResolvedValue({ entityCount: 1, edgeCount: 0 })
    mockLoadOntology.mockResolvedValue(null)
    mockJustifyBatch.mockResolvedValue({ justifiedCount: 1 })
    mockEmbedJustifications.mockResolvedValue(1)
    mockFindEntityCallerIds.mockResolvedValue([]) // no callers
    mockStoreFeatureAggregations.mockResolvedValue(undefined)

    const { justifyEntityWorkflow } = await import("../justify-entity")
    const result = await justifyEntityWorkflow({
      orgId: "org1",
      repoId: "repo1",
      entityId: "e1",
    })

    expect(result.justified).toBe(true)
    expect(result.cascadeCount).toBe(0)

    // Verify activity ordering
    const names = activityCalls.map((c) => c.name)
    expect(names).toEqual([
      "fetchEntitiesAndEdges",
      "loadOntology",
      "justifyBatch",
      "embedJustifications",
      "findEntityCallerIds",
      "storeFeatureAggregations",
    ])
  })

  it("cascades to callers via findEntityCallerIds", async () => {
    mockFetchEntitiesAndEdges.mockResolvedValue({ entityCount: 2, edgeCount: 1 })
    mockLoadOntology.mockResolvedValue(null)
    mockJustifyBatch
      .mockResolvedValueOnce({ justifiedCount: 1 }) // entity itself
      .mockResolvedValueOnce({ justifiedCount: 1 }) // cascade callers
    mockEmbedJustifications.mockResolvedValue(1)
    // findEntityCallerIds returns the caller IDs directly
    mockFindEntityCallerIds.mockResolvedValue(["e2"])
    mockStoreFeatureAggregations.mockResolvedValue(undefined)

    const { justifyEntityWorkflow } = await import("../justify-entity")
    const result = await justifyEntityWorkflow({
      orgId: "org1",
      repoId: "repo1",
      entityId: "e1",
    })

    expect(result.justified).toBe(true)
    expect(result.cascadeCount).toBe(1)

    // justifyBatch called twice: once for entity, once for callers
    const justifyBatchCalls = activityCalls.filter((c) => c.name === "justifyBatch")
    expect(justifyBatchCalls).toHaveLength(2)
  })
})
