/**
 * Rule Decay Score — weighted formula for determining rule staleness.
 * Weights: 40% override rate, 30% false positive rate, 20% recency, 10% fix rate
 */

import type { RuleHealthDoc } from "@/lib/ports/types"

const WEIGHT_OVERRIDE_RATE = 0.4
const WEIGHT_FP_RATE = 0.3
const WEIGHT_RECENCY = 0.2
const WEIGHT_FIX_RATE = 0.1

const MAX_DAYS_STALE = 90

export function calculateDecayScore(health: RuleHealthDoc): number {
  const total = health.triggered_count || 1

  // Override rate: higher = worse
  const overrideRate = health.overridden_count / total

  // False positive rate: higher = worse
  const fpRate = health.false_positive_count / total

  // Recency: days since last triggered, normalized
  const lastTriggered = health.last_triggered_at ? new Date(health.last_triggered_at) : new Date(0)
  const daysSince = (Date.now() - lastTriggered.getTime()) / (1000 * 60 * 60 * 24)
  const recencyPenalty = Math.min(daysSince / MAX_DAYS_STALE, 1)

  // Fix rate: auto-fixed / triggered, higher = better (inverted)
  const fixRate = health.auto_fixed_count / total
  const fixPenalty = 1 - fixRate

  // Combined decay score: 1.0 = healthy, 0.0 = should deprecate
  const decayScore =
    1 -
    (overrideRate * WEIGHT_OVERRIDE_RATE +
      fpRate * WEIGHT_FP_RATE +
      recencyPenalty * WEIGHT_RECENCY +
      fixPenalty * WEIGHT_FIX_RATE)

  return Math.max(0, Math.min(1, decayScore))
}

export function shouldDeprecate(health: RuleHealthDoc, threshold: number): boolean {
  const score = calculateDecayScore(health)
  return score < threshold
}
