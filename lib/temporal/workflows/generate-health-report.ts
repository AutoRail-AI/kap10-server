/**
 * Phase 4: generateHealthReportWorkflow — aggregates features, builds health
 * report, and synthesizes ADRs.
 *
 * Workflow ID: health-{orgId}-{repoId}
 * Queue: light-llm-queue
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as healthActivities from "../activities/health-report"
import type * as pipelineLogs from "../activities/pipeline-logs"

const activities = proxyActivities<typeof healthActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

const logActivities = proxyActivities<typeof pipelineLogs>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 1 },
})

export interface HealthReportInput {
  orgId: string
  repoId: string
  runId?: string
}

/** Workflow-safe log helper */
function wfLog(level: string, msg: string, input: HealthReportInput, step?: string) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:health-report] [${input.orgId}/${input.repoId}] ${msg}`)

  logActivities
    .appendPipelineLog({
      timestamp: ts,
      level: level.toLowerCase() as "info" | "warn" | "error",
      phase: "justifying",
      step: step ?? "",
      message: msg,
      meta: { repoId: input.repoId, ...(input.runId && { runId: input.runId }) },
    })
    .catch(() => {})
}

export async function generateHealthReportWorkflow(input: HealthReportInput): Promise<void> {
  wfLog("INFO", "Health report workflow started", input, "Health Report")

  // Step 1: Aggregate features (self-sufficient — fetches own data from ArangoDB)
  wfLog("INFO", "Step 9/10: Aggregating features", input, "Step 9/10")
  await activities.aggregateAndStoreFeatures(input)

  // Step 2: Build and store health report (self-sufficient)
  wfLog("INFO", "Step 9/10: Building health report", input, "Step 9/10")
  await activities.buildAndStoreHealthReport(input)

  // Step 3: Synthesize ADRs (self-sufficient)
  wfLog("INFO", "Step 10/10: Synthesizing ADRs", input, "Step 10/10")
  await activities.synthesizeAndStoreADRs(input)

  wfLog("INFO", "Health report workflow complete", input, "Complete")
}
