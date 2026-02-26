import { describe, expect, it } from "vitest"
import {
  ADRSchema,
  DomainOntologySchema,
  DriftScoreSchema,
  GraphContextSchema,
  HealthReportSchema,
  JustificationResultSchema,
  ModelRouteSchema,
  SemanticTripleSchema,
  TaxonomySchema,
} from "../schemas"

describe("Phase 4 Schemas", () => {
  describe("TaxonomySchema", () => {
    it("accepts valid values", () => {
      expect(TaxonomySchema.parse("VERTICAL")).toBe("VERTICAL")
      expect(TaxonomySchema.parse("HORIZONTAL")).toBe("HORIZONTAL")
      expect(TaxonomySchema.parse("UTILITY")).toBe("UTILITY")
    })

    it("rejects invalid values", () => {
      expect(() => TaxonomySchema.parse("INVALID")).toThrow()
      expect(() => TaxonomySchema.parse("")).toThrow()
    })
  })

  describe("SemanticTripleSchema", () => {
    it("parses valid triple", () => {
      const result = SemanticTripleSchema.parse({
        subject: "OrderService",
        predicate: "validates",
        object: "payment_amount",
      })
      expect(result.subject).toBe("OrderService")
      expect(result.predicate).toBe("validates")
    })
  })

  describe("JustificationResultSchema", () => {
    it("parses a full justification result", () => {
      const result = JustificationResultSchema.parse({
        taxonomy: "VERTICAL",
        confidence: 0.85,
        businessPurpose: "Processes payment transactions",
        domainConcepts: ["payment", "transaction"],
        featureTag: "payment_processing",
        semanticTriples: [
          { subject: "PaymentService", predicate: "processes", object: "transactions" },
        ],
        complianceTags: ["PCI-DSS"],
        reasoning: "The function name and signature indicate payment processing. It calls the Stripe API and validates amounts, confirming VERTICAL classification in the payment domain.",
      })
      expect(result.taxonomy).toBe("VERTICAL")
      expect(result.confidence).toBe(0.85)
      expect(result.complianceTags).toEqual(["PCI-DSS"])
      expect(result.reasoning).toContain("payment processing")
    })

    it("defaults complianceTags to empty array", () => {
      const result = JustificationResultSchema.parse({
        taxonomy: "UTILITY",
        confidence: 0.9,
        businessPurpose: "Test helper",
        domainConcepts: [],
        featureTag: "testing",
        semanticTriples: [],
        reasoning: "Simple test utility helper based on naming convention and file location in __tests__ directory.",
      })
      expect(result.complianceTags).toEqual([])
    })

    it("rejects confidence out of range", () => {
      expect(() =>
        JustificationResultSchema.parse({
          taxonomy: "VERTICAL",
          confidence: 1.5,
          businessPurpose: "x",
          domainConcepts: [],
          featureTag: "x",
          semanticTriples: [],
          reasoning: "test",
        })
      ).toThrow()
    })
  })

  describe("DomainOntologySchema", () => {
    it("parses valid ontology", () => {
      const result = DomainOntologySchema.parse({
        orgId: "org-1",
        repoId: "repo-1",
        terms: [{ term: "order", frequency: 42, relatedTerms: ["purchase"] }],
        ubiquitousLanguage: { order: "A customer purchase request" },
        generatedAt: "2026-01-01T00:00:00Z",
      })
      expect(result.terms).toHaveLength(1)
      expect(result.ubiquitousLanguage["order"]).toBe("A customer purchase request")
    })
  })

  describe("DriftScoreSchema", () => {
    it("parses valid drift score", () => {
      const result = DriftScoreSchema.parse({
        entityId: "e-1",
        astHashOld: "abc",
        astHashNew: "def",
        embeddingSimilarity: 0.85,
        category: "refactor",
        detectedAt: "2026-01-01T00:00:00Z",
      })
      expect(result.category).toBe("refactor")
    })
  })

  describe("HealthReportSchema", () => {
    it("parses valid health report", () => {
      const result = HealthReportSchema.parse({
        orgId: "org-1",
        repoId: "repo-1",
        totalEntities: 100,
        justifiedEntities: 95,
        averageConfidence: 0.82,
        taxonomyBreakdown: { VERTICAL: 40, HORIZONTAL: 30, UTILITY: 25 },
        risks: [{ riskType: "low_confidence", description: "5 entities", severity: "medium" }],
        generatedAt: "2026-01-01T00:00:00Z",
      })
      expect(result.totalEntities).toBe(100)
      expect(result.risks).toHaveLength(1)
    })
  })

  describe("ModelRouteSchema", () => {
    it("parses route with model", () => {
      const result = ModelRouteSchema.parse({
        tier: "standard",
        model: "gpt-4o-mini",
        reason: "default",
      })
      expect(result.tier).toBe("standard")
    })

    it("parses heuristic route without model", () => {
      const result = ModelRouteSchema.parse({
        tier: "heuristic",
        reason: "test file",
      })
      expect(result.model).toBeUndefined()
    })
  })

  describe("GraphContextSchema", () => {
    it("parses context with neighbors", () => {
      const result = GraphContextSchema.parse({
        entityId: "e-1",
        neighbors: [
          { id: "e-2", name: "helper", kind: "function", direction: "outbound" },
        ],
        centrality: 0.5,
        subgraphSummary: "Calls helper",
      })
      expect(result.neighbors).toHaveLength(1)
    })
  })

  describe("ADRSchema", () => {
    it("parses valid ADR", () => {
      const result = ADRSchema.parse({
        id: "adr-1",
        orgId: "org-1",
        repoId: "repo-1",
        featureArea: "auth",
        title: "Use JWT for authentication",
        context: "Need stateless auth",
        decision: "Use JWT tokens",
        consequences: "Need token refresh logic",
        generatedAt: "2026-01-01T00:00:00Z",
      })
      expect(result.featureArea).toBe("auth")
    })
  })
})
