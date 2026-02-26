import { describe, expect, it } from "vitest"
import type { RuleHealthDoc } from "@/lib/ports/types"
import { calculateDecayScore, shouldDeprecate } from "@/lib/rules/decay-score"

function makeHealth(overrides?: Partial<RuleHealthDoc>): RuleHealthDoc {
  return {
    id: "health-r1",
    org_id: "org-1",
    rule_id: "r1",
    triggered_count: 100,
    overridden_count: 0,
    false_positive_count: 0,
    auto_fixed_count: 0,
    last_triggered_at: new Date().toISOString(),
    decay_score: 1.0,
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe("calculateDecayScore", () => {
  it("returns score near 1.0 for perfect health (no overrides, no FPs, recently triggered, high fix rate)", () => {
    const health = makeHealth({
      triggered_count: 100,
      overridden_count: 0,
      false_positive_count: 0,
      auto_fixed_count: 100,
      last_triggered_at: new Date().toISOString(),
    })

    const score = calculateDecayScore(health)

    // No overrides (0%), no FPs (0%), just triggered (0% recency), 100% fix rate
    // Score = 1 - (0*0.4 + 0*0.3 + 0*0.2 + 0*0.1) = 1.0
    expect(score).toBeCloseTo(1.0, 1)
  })

  it("high override rate increases decay (40% weight)", () => {
    const healthLow = makeHealth({
      triggered_count: 100,
      overridden_count: 0,
      auto_fixed_count: 100,
      last_triggered_at: new Date().toISOString(),
    })
    const healthHigh = makeHealth({
      triggered_count: 100,
      overridden_count: 80,
      auto_fixed_count: 100,
      last_triggered_at: new Date().toISOString(),
    })

    const scoreLow = calculateDecayScore(healthLow)
    const scoreHigh = calculateDecayScore(healthHigh)

    // Higher override count => lower score (more decay)
    expect(scoreHigh).toBeLessThan(scoreLow)
    // Override rate of 80% * weight 0.4 = 0.32 penalty difference
    expect(scoreLow - scoreHigh).toBeCloseTo(0.32, 1)
  })

  it("high false positive rate increases decay (30% weight)", () => {
    const healthClean = makeHealth({
      triggered_count: 100,
      false_positive_count: 0,
      auto_fixed_count: 100,
      last_triggered_at: new Date().toISOString(),
    })
    const healthNoisy = makeHealth({
      triggered_count: 100,
      false_positive_count: 50,
      auto_fixed_count: 100,
      last_triggered_at: new Date().toISOString(),
    })

    const scoreClean = calculateDecayScore(healthClean)
    const scoreNoisy = calculateDecayScore(healthNoisy)

    expect(scoreNoisy).toBeLessThan(scoreClean)
  })

  it("returns score clamped between 0 and 1", () => {
    const worst = makeHealth({
      triggered_count: 100,
      overridden_count: 100,
      false_positive_count: 100,
      auto_fixed_count: 0,
      last_triggered_at: new Date(0).toISOString(),
    })

    const score = calculateDecayScore(worst)

    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })
})

describe("shouldDeprecate", () => {
  it("returns true when score is below threshold", () => {
    const health = makeHealth({
      triggered_count: 100,
      overridden_count: 90,
      false_positive_count: 80,
      auto_fixed_count: 0,
      last_triggered_at: new Date(0).toISOString(),
    })

    // This health record has terrible stats; score should be very low
    expect(shouldDeprecate(health, 0.5)).toBe(true)
  })

  it("returns false when score exceeds threshold", () => {
    const health = makeHealth({
      triggered_count: 100,
      overridden_count: 0,
      false_positive_count: 0,
      auto_fixed_count: 100,
      last_triggered_at: new Date().toISOString(),
    })

    // Perfect health; score ~1.0
    expect(shouldDeprecate(health, 0.5)).toBe(false)
  })
})
