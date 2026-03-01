import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
}))

vi.mock("@/lib/llm/config", () => ({
  LLM_MODELS: { fast: "test-fast", standard: "test-standard", premium: "test-premium" },
  LLM_PROVIDER: "google",
  getLLMApiKey: () => "test-key",
  MODEL_COSTS: {},
  MODEL_COST_FALLBACK: { input: 0, output: 0 },
}))

import { type Container, createTestContainer } from "@/lib/di/container"

// We need to set up the container before importing activities
let container: Container

function setupContainer() {
  container = createTestContainer()
  // Override the mock LLM to return valid justification results
  container.llmProvider = {
    async generateObject() {
      return {
        object: {
          taxonomy: "VERTICAL",
          confidence: 0.85,
          businessPurpose: "Test business purpose",
          domainConcepts: ["test"],
          featureTag: "test_feature",
          semanticTriples: [],
          complianceTags: [],
        },
        usage: { inputTokens: 100, outputTokens: 50 },
      }
    },
    async *streamText() {
      yield "test"
    },
    async embed() {
      return [[0.1, 0.2, 0.3]]
    },
  }

  // Use __setTestContainer pattern
  vi.doMock("@/lib/di/container", () => ({
    getContainer: () => container,
    createTestContainer,
  }))
}

describe("justification activities", () => {
  beforeEach(() => {
    setupContainer()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetchEntitiesAndEdges returns counts only", async () => {
    // Seed some entities and edges in the fake graph store
    await container.graphStore.upsertEntity("org-1", {
      id: "e-1", org_id: "org-1", repo_id: "repo-1",
      kind: "function", name: "test", file_path: "a.ts",
    })

    const { fetchEntitiesAndEdges } = await import("../justification")
    const result = await fetchEntitiesAndEdges({ orgId: "org-1", repoId: "repo-1" })

    expect(result).toHaveProperty("entityCount")
    expect(result).toHaveProperty("edgeCount")
    expect(typeof result.entityCount).toBe("number")
    expect(typeof result.edgeCount).toBe("number")
    // Should NOT have entities or edges arrays
    expect(result).not.toHaveProperty("entities")
    expect(result).not.toHaveProperty("edges")
  })

  it("performTopologicalSort stores levels in Redis and returns { levelCount }", async () => {
    // Seed entities and edges
    await container.graphStore.upsertEntity("o", {
      id: "a", org_id: "o", repo_id: "r", kind: "function", name: "a", file_path: "a.ts",
    })
    await container.graphStore.upsertEntity("o", {
      id: "b", org_id: "o", repo_id: "r", kind: "function", name: "b", file_path: "b.ts",
    })
    await container.graphStore.upsertEdge("o", {
      _from: "functions/a", _to: "functions/b", kind: "calls", org_id: "o", repo_id: "r",
    })

    const { performTopologicalSort, fetchTopologicalLevel } = await import("../justification")
    const result = await performTopologicalSort({ orgId: "o", repoId: "r" })

    // Should return only level count, not the full array
    expect(result).toEqual({ levelCount: 2 })

    // Levels should be readable from Redis via fetchTopologicalLevel
    const level0 = await fetchTopologicalLevel({ orgId: "o", repoId: "r" }, 0)
    const level1 = await fetchTopologicalLevel({ orgId: "o", repoId: "r" }, 1)
    expect(typeof level0[0]).toBe("string")
    expect(level0[0]).toBe("b") // leaf first
    expect(level1[0]).toBe("a")
  })

  // Note: justifyBatch is not unit-tested here because it uses require("@/lib/llm/config")
  // which can't resolve path aliases in vitest's Node require(). It is tested
  // via the workflow-level mock tests in justify-entity.test.ts and justify-repo workflow.
})
