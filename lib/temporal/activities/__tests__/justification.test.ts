import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
}))

import { createTestContainer, type Container } from "@/lib/di/container"
import type { EntityDoc, EdgeDoc } from "@/lib/ports/types"

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

  it("stores justifications in graph store", async () => {
    const { storeJustifications } = await import("../justification")

    const justifications = [{
      id: "j-1",
      org_id: "org-1",
      repo_id: "repo-1",
      entity_id: "e-1",
      taxonomy: "VERTICAL" as const,
      confidence: 0.85,
      business_purpose: "Test",
      domain_concepts: ["test"],
      feature_tag: "test_feature",
      semantic_triples: [],
      compliance_tags: [],
      model_tier: "standard" as const,
      valid_from: "2026-01-01",
      valid_to: null,
      created_at: "2026-01-01",
    }]

    await storeJustifications({ orgId: "org-1", repoId: "repo-1" }, justifications)

    const stored = await container.graphStore.getJustification("org-1", "e-1")
    expect(stored).toBeDefined()
    expect(stored!.taxonomy).toBe("VERTICAL")
  })

  it("performs topological sort", async () => {
    const { performTopologicalSort } = await import("../justification")

    const entities: EntityDoc[] = [
      { id: "a", org_id: "o", repo_id: "r", kind: "function", name: "a", file_path: "a.ts" },
      { id: "b", org_id: "o", repo_id: "r", kind: "function", name: "b", file_path: "b.ts" },
    ]
    const edges: EdgeDoc[] = [
      { _from: "functions/a", _to: "functions/b", kind: "calls", org_id: "o", repo_id: "r" },
    ]

    const levels = await performTopologicalSort(entities, edges)
    expect(levels).toHaveLength(2)
    expect(levels[0]![0]!.id).toBe("b") // leaf first
  })
})
