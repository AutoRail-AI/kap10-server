/**
 * Phase 6: Rule decay evaluation activities.
 */

import { heartbeat } from "@temporalio/activity"

export interface EvaluateDecayInput {
  orgId: string
  threshold: number
}

export interface DecayResult {
  rulesEvaluated: number
  rulesDeprecated: number
  rulesArchived: number
}

export async function evaluateRuleDecay(input: EvaluateDecayInput): Promise<DecayResult> {
  const { getContainer } = require("@/lib/di/container") as typeof import("@/lib/di/container")
  const { calculateDecayScore, shouldDeprecate } = require("@/lib/rules/decay-score") as typeof import("@/lib/rules/decay-score")
  const container = getContainer()

  heartbeat("Fetching rules")

  const rules = await container.graphStore.queryRules(input.orgId, {
    orgId: input.orgId,
    status: "active",
    limit: 100,
  })

  let rulesDeprecated = 0
  let rulesArchived = 0

  for (const rule of rules) {
    heartbeat(`Evaluating rule ${rule.id}`)

    const health = await container.graphStore.getRuleHealth(input.orgId, rule.id)
    if (!health) continue

    const decayScore = calculateDecayScore(health)

    // Update the decay score
    await container.graphStore.upsertRuleHealth(input.orgId, {
      ...health,
      decay_score: decayScore,
      updated_at: new Date().toISOString(),
    })

    if (shouldDeprecate(health, input.threshold)) {
      // Deprecate rules with low decay scores
      if (health.triggered_count === 0) {
        // Never triggered — archive directly
        await container.graphStore.archiveRule(input.orgId, rule.id)
        rulesArchived++
      } else {
        // Has been triggered but is stale — deprecate
        await container.graphStore.upsertRule(input.orgId, {
          ...rule,
          status: "deprecated",
          updated_at: new Date().toISOString(),
        })
        rulesDeprecated++
      }
    }
  }

  return {
    rulesEvaluated: rules.length,
    rulesDeprecated,
    rulesArchived,
  }
}
