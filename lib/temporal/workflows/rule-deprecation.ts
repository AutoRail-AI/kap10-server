/**
 * Phase 6: Rule Deprecation Workflow — auto-archives stale rules based on decay scores.
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as ruleDecay from "../activities/rule-decay"

const activities = proxyActivities<typeof ruleDecay>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  heartbeatTimeout: "1m",
  retry: { maximumAttempts: 2 },
})

export interface RuleDeprecationInput {
  orgId: string
  threshold?: number
}

export async function ruleDeprecationWorkflow(input: RuleDeprecationInput): Promise<{
  rulesEvaluated: number
  rulesDeprecated: number
  rulesArchived: number
}> {
  const result = await activities.evaluateRuleDecay({
    orgId: input.orgId,
    threshold: input.threshold ?? 0.6,
  })

  return result
}
