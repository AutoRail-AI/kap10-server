import { describe, expect, it } from "vitest"
import type { DomainOntologyDoc, EntityDoc, JustificationDoc } from "@/lib/ports/types"
import { buildJustificationPrompt } from "../prompt-builder"
import type { GraphContext } from "../schemas"

describe("buildJustificationPrompt", () => {
  const entity: EntityDoc = {
    id: "e1",
    org_id: "o",
    repo_id: "r",
    kind: "function",
    name: "processOrder",
    file_path: "src/orders/service.ts",
    start_line: 42,
    signature: "async processOrder(orderId: string): Promise<Order>",
  }

  const graphContext: GraphContext = {
    entityId: "e1",
    neighbors: [
      { id: "e2", name: "validateOrder", kind: "function", direction: "inbound" },
      { id: "e3", name: "saveOrder", kind: "function", direction: "outbound" },
    ],
    centrality: 0.6,
    subgraphSummary: "processOrder is a central node",
  }

  it("includes entity details", () => {
    const prompt = buildJustificationPrompt(entity, graphContext, null, [])
    expect(prompt).toContain("processOrder")
    expect(prompt).toContain("function")
    expect(prompt).toContain("src/orders/service.ts")
    expect(prompt).toContain("42")
  })

  it("includes graph neighborhood", () => {
    const prompt = buildJustificationPrompt(entity, graphContext, null, [])
    expect(prompt).toContain("validateOrder")
    expect(prompt).toContain("saveOrder")
    expect(prompt).toContain("inbound")
    expect(prompt).toContain("outbound")
  })

  it("includes domain ontology when provided", () => {
    const ontology: DomainOntologyDoc = {
      id: "ont-1",
      org_id: "o",
      repo_id: "r",
      terms: [{ term: "order", frequency: 10, relatedTerms: ["purchase"] }],
      ubiquitous_language: { order: "A customer purchase request" },
      generated_at: "2026-01-01T00:00:00Z",
    }
    const prompt = buildJustificationPrompt(entity, graphContext, ontology, [])
    expect(prompt).toContain("order")
    expect(prompt).toContain("A customer purchase request")
  })

  it("includes dependency justifications", () => {
    const depJustification: JustificationDoc = {
      id: "j-1",
      org_id: "o",
      repo_id: "r",
      entity_id: "e3",
      taxonomy: "VERTICAL",
      confidence: 0.9,
      business_purpose: "Persists order to database",
      domain_concepts: ["persistence"],
      feature_tag: "order_management",
      semantic_triples: [],
      compliance_tags: [],
      model_tier: "standard",
      valid_from: "2026-01-01",
      valid_to: null,
      created_at: "2026-01-01",
    }
    const prompt = buildJustificationPrompt(entity, graphContext, null, [depJustification])
    expect(prompt).toContain("Persists order to database")
    expect(prompt).toContain("VERTICAL")
  })

  it("includes test context when provided via intent signals", () => {
    const testContext = {
      testFiles: ["src/orders/service.test.ts"],
      assertions: ["it should process a valid order"],
    }
    const prompt = buildJustificationPrompt(entity, graphContext, null, [], testContext, {
      intentSignals: {
        fromTests: ["it should process a valid order"],
        fromEntryPoints: [],
        fromNaming: null,
        fromCommits: [],
      },
    })
    expect(prompt).toContain("process a valid order")
    expect(prompt).toContain("Intent Signal")
  })

  it("includes JSON response instructions", () => {
    const prompt = buildJustificationPrompt(entity, graphContext, null, [])
    expect(prompt).toContain("taxonomy")
    expect(prompt).toContain("VERTICAL")
    expect(prompt).toContain("HORIZONTAL")
    expect(prompt).toContain("UTILITY")
    expect(prompt).toContain("semanticTriples")
  })
})
