import { describe, expect, it } from "vitest"
import { LLM_MODELS } from "@/lib/llm/config"
import type { EntityDoc } from "@/lib/ports/types"
import { applyHeuristics, routeModel } from "../model-router"

function makeEntity(overrides: Partial<EntityDoc> = {}): EntityDoc {
  return {
    id: "e-1",
    org_id: "org-1",
    repo_id: "repo-1",
    kind: "function",
    name: "processPayment",
    file_path: "src/payments/service.ts",
    ...overrides,
  }
}

describe("applyHeuristics", () => {
  it("classifies test files as UTILITY", () => {
    const result = applyHeuristics(makeEntity({ file_path: "src/__tests__/foo.test.ts" }))
    expect(result).not.toBeNull()
    expect(result!.taxonomy).toBe("UTILITY")
    expect(result!.featureTag).toBe("testing")
  })

  it("classifies .spec files as UTILITY", () => {
    const result = applyHeuristics(makeEntity({ file_path: "src/foo.spec.tsx" }))
    expect(result).not.toBeNull()
    expect(result!.taxonomy).toBe("UTILITY")
  })

  it("classifies config files as HORIZONTAL", () => {
    const result = applyHeuristics(makeEntity({ file_path: "tsconfig.json" }))
    expect(result).not.toBeNull()
    expect(result!.taxonomy).toBe("HORIZONTAL")
    expect(result!.featureTag).toBe("configuration")
  })

  it("classifies type/interface/enum as UTILITY", () => {
    const result = applyHeuristics(makeEntity({ kind: "interface" }))
    expect(result).not.toBeNull()
    expect(result!.taxonomy).toBe("UTILITY")
    expect(result!.featureTag).toBe("type-system")
  })

  it("classifies enum as UTILITY", () => {
    const result = applyHeuristics(makeEntity({ kind: "enum" }))
    expect(result).not.toBeNull()
    expect(result!.taxonomy).toBe("UTILITY")
  })

  it("returns null for regular business entities", () => {
    const result = applyHeuristics(makeEntity())
    expect(result).toBeNull()
  })

  it("classifies index.ts files as HORIZONTAL", () => {
    const result = applyHeuristics(makeEntity({ kind: "file", name: "index.ts", file_path: "src/index.ts" }))
    expect(result).not.toBeNull()
    expect(result!.taxonomy).toBe("HORIZONTAL")
  })
})

describe("routeModel", () => {
  it("routes test files to standard tier (zero-skip policy)", () => {
    const route = routeModel(makeEntity({ file_path: "src/__tests__/foo.test.ts" }))
    expect(route.tier).toBe("standard")
  })

  it("routes high-centrality entities to premium", () => {
    const route = routeModel(makeEntity(), { centrality: 0.9 })
    expect(route.tier).toBe("premium")
    expect(route.model).toBe(LLM_MODELS.premium)
  })

  it("routes variables to fast tier", () => {
    const route = routeModel(makeEntity({ kind: "variable" }))
    expect(route.tier).toBe("fast")
    expect(route.model).toBe(LLM_MODELS.fast)
  })

  it("routes regular entities to standard tier", () => {
    const route = routeModel(makeEntity())
    expect(route.tier).toBe("standard")
  })

  it("routes complex dependency entities to premium", () => {
    const route = routeModel(makeEntity(), { hasComplexDependencies: true })
    expect(route.tier).toBe("premium")
  })
})
