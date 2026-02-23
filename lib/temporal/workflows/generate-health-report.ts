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
}

export async function generateHealthReportWorkflow(input: HealthReportInput): Promise<void> {
  // Step 1: Fetch justifications and entities
  const data = await activities.fetchJustificationsAndEntities(input)

  // Step 2: Aggregate features
  const features = await activities.aggregateAndStoreFeatures(input, data)

  // Step 3: Build and store health report (now passes full data for expanded risk detection)
  await activities.buildAndStoreHealthReport(input, data, features)

  // Step 4: Synthesize ADRs
  await activities.synthesizeAndStoreADRs(input, features, data.justifications)
}
