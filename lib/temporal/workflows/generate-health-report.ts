/**
 * Phase 4: generateHealthReportWorkflow — aggregates features, builds health
 * report, and synthesizes ADRs.
 *
 * Workflow ID: health-{orgId}-{repoId}
 * Queue: light-llm-queue
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as healthActivities from "../activities/health-report"

const activities = proxyActivities<typeof healthActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

export interface HealthReportInput {
  orgId: string
  repoId: string
  runId?: string
}

export async function generateHealthReportWorkflow(input: HealthReportInput): Promise<void> {
  // Step 1: Aggregate features (self-sufficient — fetches own data from ArangoDB)
  await activities.aggregateAndStoreFeatures(input)

  // Step 2: Build and store health report (self-sufficient)
  await activities.buildAndStoreHealthReport(input)

  // Step 3: Synthesize ADRs (self-sufficient)
  await activities.synthesizeAndStoreADRs(input)
}
