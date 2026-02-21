/**
 * P4-TEST-10: Workflow test for justifyEntityWorkflow.
 *
 * Verifies:
 * - Activity call ordering: fetchEntitiesAndEdges → loadOntology → justifyBatch → storeJustifications → embedJustifications → storeFeatureAggregations
 * - Returns { justified: false } when entity not found
 * - Cascade: re-justifies callers when entity has incoming call edges
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const activityCalls: { name: string; args: unknown[] }[] = []

const mockFetchEntitiesAndEdges = vi.fn()
const mockLoadOntology = vi.fn()
const mockJustifyBatch = vi.fn()
const mockStoreJustifications = vi.fn()
const mockStoreFeatureAggregations = vi.fn()
const mockEmbedJustifications = vi.fn()

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
            storeJustifications: mockStoreJustifications,
            storeFeatureAggregations: mockStoreFeatureAggregations,
            embedJustifications: mockEmbedJustifications,
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

  it("returns justified=false when entity not found", async () => {
    mockFetchEntitiesAndEdges.mockResolvedValue({ entities: [], edges: [] })
    mockLoadOntology.mockResolvedValue(null)

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
    const entity = { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "doStuff", file_path: "a.ts" }
    const justification = {
      id: "j1",
      org_id: "org1",
      repo_id: "repo1",
      entity_id: "e1",
      taxonomy: "VERTICAL",
      confidence: 0.9,
      business_purpose: "Core business logic",
      domain_concepts: ["payment"],
      feature_tag: "payments",
      semantic_triples: [],
      compliance_tags: [],
      model_tier: "fast",
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_to: null,
      created_at: "2026-01-01T00:00:00.000Z",
    }

    mockFetchEntitiesAndEdges.mockResolvedValue({ entities: [entity], edges: [] })
    mockLoadOntology.mockResolvedValue(null)
    mockJustifyBatch.mockResolvedValue([justification])
    mockStoreJustifications.mockResolvedValue(undefined)
    mockEmbedJustifications.mockResolvedValue(1)
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
      "storeJustifications",
      "embedJustifications",
      "storeFeatureAggregations",
    ])
  })

  it("cascades to callers when entity has incoming call edges", async () => {
    const entity = { id: "e1", org_id: "org1", repo_id: "repo1", kind: "function", name: "helper", file_path: "a.ts" }
    const caller = { id: "e2", org_id: "org1", repo_id: "repo1", kind: "function", name: "main", file_path: "b.ts" }
    const edge = { _from: "functions/e2", _to: "functions/e1", kind: "calls", org_id: "org1", repo_id: "repo1" }
    const justification = {
      id: "j1", org_id: "org1", repo_id: "repo1", entity_id: "e1",
      taxonomy: "UTILITY" as const, confidence: 0.8, business_purpose: "Helper",
      domain_concepts: [], feature_tag: "utils", semantic_triples: [],
      compliance_tags: [], model_tier: "fast" as const,
      valid_from: "2026-01-01T00:00:00.000Z", valid_to: null, created_at: "2026-01-01T00:00:00.000Z",
    }
    const callerJustification = { ...justification, id: "j2", entity_id: "e2" }

    mockFetchEntitiesAndEdges.mockResolvedValue({ entities: [entity, caller], edges: [edge] })
    mockLoadOntology.mockResolvedValue(null)
    mockJustifyBatch
      .mockResolvedValueOnce([justification])
      .mockResolvedValueOnce([callerJustification])
    mockStoreJustifications.mockResolvedValue(undefined)
    mockEmbedJustifications.mockResolvedValue(1)
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
