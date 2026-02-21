import { describe, it, expect } from "vitest"
import { buildHealthReport } from "../health-report-builder"
import type { JustificationDoc, FeatureAggregation } from "@/lib/ports/types"

function makeJust(id: string, opts: { taxonomy?: "VERTICAL" | "HORIZONTAL" | "UTILITY"; confidence?: number } = {}): JustificationDoc {
  return {
    id, org_id: "o", repo_id: "r", entity_id: `e-${id}`,
    taxonomy: opts.taxonomy ?? "VERTICAL", confidence: opts.confidence ?? 0.85,
    business_purpose: "test", domain_concepts: [], feature_tag: "auth",
    semantic_triples: [], compliance_tags: [], model_tier: "standard",
    valid_from: "2026-01-01", valid_to: null, created_at: "2026-01-01",
  }
}

function makeFeature(tag: string, count: number): FeatureAggregation {
  return {
    id: `r_${tag}`, org_id: "o", repo_id: "r", feature_tag: tag,
    entity_count: count, entry_points: [], hot_paths: [],
    taxonomy_breakdown: { VERTICAL: count }, average_confidence: 0.8,
    created_at: "2026-01-01",
  }
}

describe("buildHealthReport", () => {
  it("computes basic stats", () => {
    const justifications = [
      makeJust("1", { taxonomy: "VERTICAL", confidence: 0.9 }),
      makeJust("2", { taxonomy: "HORIZONTAL", confidence: 0.8 }),
      makeJust("3", { taxonomy: "UTILITY", confidence: 0.7 }),
    ]

    const report = buildHealthReport(justifications, [], "o", "r")
    expect(report.total_entities).toBe(3)
    expect(report.justified_entities).toBe(3)
    expect(report.average_confidence).toBeCloseTo(0.8, 1)
    expect(report.taxonomy_breakdown["VERTICAL"]).toBe(1)
    expect(report.taxonomy_breakdown["HORIZONTAL"]).toBe(1)
  })

  it("flags low confidence entities as risk", () => {
    const justifications = [
      makeJust("1", { confidence: 0.3 }),
      makeJust("2", { confidence: 0.4 }),
      makeJust("3", { confidence: 0.9 }),
    ]

    const report = buildHealthReport(justifications, [], "o", "r")
    const lowConfRisk = report.risks.find((r) => r.riskType === "low_confidence")
    expect(lowConfRisk).toBeDefined()
    expect(lowConfRisk!.description).toContain("2 entities")
  })

  it("flags single-entity features", () => {
    const justifications = [makeJust("1")]
    const features = [makeFeature("orphan_feature", 1)]

    const report = buildHealthReport(justifications, features, "o", "r")
    const orphanRisk = report.risks.find((r) => r.riskType === "single_entity_feature")
    expect(orphanRisk).toBeDefined()
  })

  it("flags high UTILITY ratio", () => {
    const justifications = [
      makeJust("1", { taxonomy: "UTILITY" }),
      makeJust("2", { taxonomy: "UTILITY" }),
      makeJust("3", { taxonomy: "UTILITY" }),
    ]

    const report = buildHealthReport(justifications, [], "o", "r")
    const utilRisk = report.risks.find((r) => r.riskType === "high_utility_ratio")
    expect(utilRisk).toBeDefined()
  })

  it("returns empty risks for healthy codebase", () => {
    const justifications = [
      makeJust("1", { taxonomy: "VERTICAL", confidence: 0.9 }),
      makeJust("2", { taxonomy: "HORIZONTAL", confidence: 0.85 }),
    ]
    const features = [makeFeature("auth", 5), makeFeature("payments", 3)]

    const report = buildHealthReport(justifications, features, "o", "r")
    expect(report.risks).toEqual([])
  })
})
