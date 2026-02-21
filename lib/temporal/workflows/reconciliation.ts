/**
 * Phase 5: Reconciliation cron workflow.
 * Periodically checks all ready repos against GitHub latest SHA.
 * If a repo's lastIndexedSha doesn't match, triggers re-index.
 */

import { proxyActivities, sleep } from "@temporalio/workflow"
import type * as light from "../activities/indexing-light"

const lightActivities = proxyActivities<typeof light>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  heartbeatTimeout: "1m",
  retry: { maximumAttempts: 2 },
})

export interface ReconciliationInput {
  orgId: string
}

export interface ReconciliationResult {
  reposChecked: number
  reposTriggered: number
  errors: string[]
}

/**
 * Check all ready repos in an org against GitHub latest SHA.
 * Rate limited to 10 triggers per cycle.
 */
export async function reconciliationWorkflow(_input: ReconciliationInput): Promise<ReconciliationResult> {
  // This workflow is a placeholder that will be fleshed out
  // when the reconciliation activity is connected to the relational store.
  // For now, return empty results.
  return {
    reposChecked: 0,
    reposTriggered: 0,
    errors: [],
  }
}
