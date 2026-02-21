import { describe, it, expect } from "vitest"
import { normalizeJustifications, extractSemanticTriples, deduplicateFeatures } from "../post-processor"
import type { JustificationDoc } from "@/lib/ports/types"

function makeJustification(overrides: Partial<JustificationDoc> = {}): JustificationDoc {
  return {
    id: "j-1",
    org_id: "org-1",
    repo_id: "repo-1",
    entity_id: "e-1",
    taxonomy: "VERTICAL",
    confidence: 0.85,
    business_purpose: "Processes payments",
    domain_concepts: ["Payment", "Transaction"],
    feature_tag: "Payment Processing",
    semantic_triples: [
      { subject: "PaymentService", predicate: "processes", object: "transactions" },
    ],
    compliance_tags: ["pci-dss"],
    model_tier: "standard",
    valid_from: "2026-01-01",
    valid_to: null,
    created_at: "2026-01-01",
    ...overrides,
  }
}

describe("normalizeJustifications", () => {
  it("normalizes feature tags to lowercase snake_case", () => {
    const result = normalizeJustifications([makeJustification()])
    expect(result[0]!.feature_tag).toBe("payment_processing")
  })

  it("lowercases domain concepts", () => {
    const result = normalizeJustifications([makeJustification()])
    expect(result[0]!.domain_concepts).toEqual(["payment", "transaction"])
  })

  it("uppercases compliance tags", () => {
    const result = normalizeJustifications([makeJustification()])
    expect(result[0]!.compliance_tags).toEqual(["PCI-DSS"])
  })
})

describe("extractSemanticTriples", () => {
  it("deduplicates triples", () => {
    const j1 = makeJustification({
      id: "j-1",
      semantic_triples: [
        { subject: "A", predicate: "calls", object: "B" },
      ],
    })
    const j2 = makeJustification({
      id: "j-2",
      semantic_triples: [
        { subject: "A", predicate: "calls", object: "B" },
        { subject: "C", predicate: "uses", object: "D" },
      ],
    })

    const result = extractSemanticTriples([j1, j2])
    expect(result).toHaveLength(2)
  })

  it("returns empty for no triples", () => {
    const j = makeJustification({ semantic_triples: [] })
    expect(extractSemanticTriples([j])).toEqual([])
  })
})

describe("deduplicateFeatures", () => {
  it("groups by feature tag", () => {
    const j1 = makeJustification({ id: "j-1", entity_id: "e-1", feature_tag: "auth" })
    const j2 = makeJustification({ id: "j-2", entity_id: "e-2", feature_tag: "auth" })
    const j3 = makeJustification({ id: "j-3", entity_id: "e-3", feature_tag: "payments" })

    const result = deduplicateFeatures([j1, j2, j3], "org-1", "repo-1")
    expect(result).toHaveLength(2)

    const authFeature = result.find((f) => f.feature_tag === "auth")
    expect(authFeature!.entity_count).toBe(2)
  })

  it("computes average confidence", () => {
    const j1 = makeJustification({ id: "j-1", entity_id: "e-1", feature_tag: "auth", confidence: 0.8 })
    const j2 = makeJustification({ id: "j-2", entity_id: "e-2", feature_tag: "auth", confidence: 0.6 })

    const result = deduplicateFeatures([j1, j2], "org-1", "repo-1")
    const authFeature = result.find((f) => f.feature_tag === "auth")
    expect(authFeature!.average_confidence).toBe(0.7)
  })
})
