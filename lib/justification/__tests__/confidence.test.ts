import { describe, expect, it } from "vitest"
import { computeCalibratedConfidence, isDescriptiveName } from "../confidence"
import type { ConfidenceSignals } from "../confidence"

describe("computeCalibratedConfidence", () => {
  const fullSignals: ConfidenceSignals = {
    hasCallers: true,
    hasCallees: true,
    hasTests: true,
    hasDocs: true,
    hasDescriptiveName: true,
    llmConfidence: 1.0,
    llmModelTier: "premium",
    pageRankPercentile: 90,
  }

  it("full signals → high composite (~0.85-1.0)", () => {
    const result = computeCalibratedConfidence(fullSignals)
    expect(result.composite).toBeGreaterThanOrEqual(0.85)
    expect(result.composite).toBeLessThanOrEqual(1.0)
    expect(result.breakdown.structural).toBe(0.5)
    expect(result.breakdown.intent).toBe(0.3)
    expect(result.breakdown.llm).toBeCloseTo(0.2, 2)
  })

  it("no signals → low composite (~0.15 or less)", () => {
    const result = computeCalibratedConfidence({
      hasCallers: false,
      hasCallees: false,
      hasTests: false,
      hasDocs: false,
      hasDescriptiveName: false,
      llmConfidence: 0,
      llmModelTier: "heuristic",
      pageRankPercentile: 0,
    })
    expect(result.composite).toBeLessThanOrEqual(0.15)
    expect(result.breakdown.structural).toBe(0)
    expect(result.breakdown.intent).toBe(0)
    expect(result.breakdown.llm).toBe(0)
  })

  it("only structural signals → intent and llm are 0", () => {
    const result = computeCalibratedConfidence({
      hasCallers: true,
      hasCallees: true,
      hasTests: false,
      hasDocs: false,
      hasDescriptiveName: false,
      llmConfidence: 0,
      llmModelTier: "fast",
      pageRankPercentile: 80,
    })
    expect(result.breakdown.structural).toBe(0.5) // 0.25 + 0.15 + 0.10
    expect(result.breakdown.intent).toBe(0)
    expect(result.breakdown.llm).toBe(0)
    expect(result.composite).toBe(0.5)
  })

  it("premium tier LLM confidence weighted higher than fast tier", () => {
    const base = {
      hasCallers: false,
      hasCallees: false,
      hasTests: false,
      hasDocs: false,
      hasDescriptiveName: false,
      llmConfidence: 0.9,
      pageRankPercentile: 0,
    }

    const premium = computeCalibratedConfidence({ ...base, llmModelTier: "premium" })
    const fast = computeCalibratedConfidence({ ...base, llmModelTier: "fast" })

    expect(premium.breakdown.llm).toBeGreaterThan(fast.breakdown.llm)
    expect(premium.composite).toBeGreaterThan(fast.composite)
  })

  it("pageRankPercentile below 50 does not contribute", () => {
    const low = computeCalibratedConfidence({
      ...fullSignals,
      pageRankPercentile: 30,
    })
    // structural should be 0.4 (0.25 + 0.15, no 0.10 for low percentile)
    expect(low.breakdown.structural).toBe(0.4)
  })

  it("composite is clamped to 1.0", () => {
    const result = computeCalibratedConfidence(fullSignals)
    expect(result.composite).toBeLessThanOrEqual(1.0)
  })
})

describe("isDescriptiveName", () => {
  it("non-descriptive names return false", () => {
    expect(isDescriptiveName("get")).toBe(false)
    expect(isDescriptiveName("set")).toBe(false)
    expect(isDescriptiveName("run")).toBe(false)
    expect(isDescriptiveName("foo")).toBe(false)
    expect(isDescriptiveName("bar")).toBe(false)
    expect(isDescriptiveName("data")).toBe(false)
    expect(isDescriptiveName("tmp")).toBe(false)
    expect(isDescriptiveName("cb")).toBe(false)
  })

  it("short names (<=3 chars) return false", () => {
    expect(isDescriptiveName("fn")).toBe(false)
    expect(isDescriptiveName("abc")).toBe(false)
  })

  it("descriptive names return true", () => {
    expect(isDescriptiveName("processPayment")).toBe(true)
    expect(isDescriptiveName("validateUserInput")).toBe(true)
    expect(isDescriptiveName("computeBlastRadius")).toBe(true)
    expect(isDescriptiveName("fetchOrders")).toBe(true)
  })

  it("names with non-descriptive base after stripping return false", () => {
    expect(isDescriptiveName("handle")).toBe(false)
    expect(isDescriptiveName("process")).toBe(false)
  })
})
