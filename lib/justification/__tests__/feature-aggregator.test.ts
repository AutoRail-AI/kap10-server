import { describe, expect, it } from "vitest"
import type { EdgeDoc, EntityDoc, JustificationDoc } from "@/lib/ports/types"
import { aggregateFeatures } from "../feature-aggregator"

function makeJust(id: string, entityId: string, featureTag: string, taxonomy: "VERTICAL" | "HORIZONTAL" | "UTILITY" = "VERTICAL"): JustificationDoc {
  return {
    id, org_id: "o", repo_id: "r", entity_id: entityId,
    taxonomy, confidence: 0.85, business_purpose: "test",
    domain_concepts: [], feature_tag: featureTag,
    semantic_triples: [], compliance_tags: [],
    model_tier: "standard", valid_from: "2026-01-01", valid_to: null, created_at: "2026-01-01",
  }
}

function makeEntity(id: string, kind = "function"): EntityDoc {
  return { id, org_id: "o", repo_id: "r", kind, name: id, file_path: "a.ts" }
}

describe("aggregateFeatures", () => {
  it("groups justifications by feature tag", () => {
    const justifications = [
      makeJust("j1", "e1", "auth"),
      makeJust("j2", "e2", "auth"),
      makeJust("j3", "e3", "payments"),
    ]
    const entities = [makeEntity("e1"), makeEntity("e2"), makeEntity("e3")]

    const result = aggregateFeatures(justifications, entities, [], "o", "r")
    expect(result).toHaveLength(2)

    const authFeature = result.find((f) => f.feature_tag === "auth")
    expect(authFeature!.entity_count).toBe(2)
  })

  it("identifies entry points from external callers", () => {
    const justifications = [
      makeJust("j1", "e1", "auth"),
      makeJust("j2", "e2", "auth"),
    ]
    const entities = [makeEntity("e1"), makeEntity("e2"), makeEntity("e3")]
    const edges: EdgeDoc[] = [
      { _from: "functions/e3", _to: "functions/e1", kind: "calls", org_id: "o", repo_id: "r" },
      { _from: "functions/e1", _to: "functions/e2", kind: "calls", org_id: "o", repo_id: "r" },
    ]

    const result = aggregateFeatures(justifications, entities, edges, "o", "r")
    const authFeature = result.find((f) => f.feature_tag === "auth")
    expect(authFeature!.entry_points).toContain("e1")
  })

  it("computes taxonomy breakdown", () => {
    const justifications = [
      makeJust("j1", "e1", "auth", "VERTICAL"),
      makeJust("j2", "e2", "auth", "HORIZONTAL"),
      makeJust("j3", "e3", "auth", "UTILITY"),
    ]
    const entities = [makeEntity("e1"), makeEntity("e2"), makeEntity("e3")]

    const result = aggregateFeatures(justifications, entities, [], "o", "r")
    const authFeature = result.find((f) => f.feature_tag === "auth")
    expect(authFeature!.taxonomy_breakdown["VERTICAL"]).toBe(1)
    expect(authFeature!.taxonomy_breakdown["HORIZONTAL"]).toBe(1)
    expect(authFeature!.taxonomy_breakdown["UTILITY"]).toBe(1)
  })

  it("returns empty for empty input", () => {
    expect(aggregateFeatures([], [], [], "o", "r")).toEqual([])
  })
})
