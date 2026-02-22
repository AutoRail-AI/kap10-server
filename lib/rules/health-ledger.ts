/**
 * Rule Health Ledger — per-rule telemetry, counter increments.
 */

import type { Container } from "@/lib/di/container"
import type { RuleHealthDoc } from "@/lib/ports/types"

export type HealthEvent = "triggered" | "overridden" | "false_positive" | "auto_fixed"

export async function incrementRuleHealth(
  container: Container,
  orgId: string,
  ruleId: string,
  event: HealthEvent
): Promise<void> {
  const existing = await container.graphStore.getRuleHealth(orgId, ruleId)

  const health: RuleHealthDoc = existing ?? {
    id: `health-${ruleId}`,
    org_id: orgId,
    rule_id: ruleId,
    triggered_count: 0,
    overridden_count: 0,
    false_positive_count: 0,
    auto_fixed_count: 0,
    last_triggered_at: null,
    decay_score: 1.0,
    updated_at: new Date().toISOString(),
  }

  switch (event) {
    case "triggered":
      health.triggered_count++
      health.last_triggered_at = new Date().toISOString()
      break
    case "overridden":
      health.overridden_count++
      break
    case "false_positive":
      health.false_positive_count++
      break
    case "auto_fixed":
      health.auto_fixed_count++
      break
  }

  health.updated_at = new Date().toISOString()
  await container.graphStore.upsertRuleHealth(orgId, health)
}

export async function getRuleHealthSummary(
  container: Container,
  orgId: string,
  ruleId: string
): Promise<RuleHealthDoc | null> {
  return container.graphStore.getRuleHealth(orgId, ruleId)
}
