/**
 * Phase 6: Blast Radius Simulation Workflow
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as simulation from "../activities/rule-simulation"
import type { ImpactReportDoc } from "@/lib/ports/types"

const heavyActivities = proxyActivities<typeof simulation>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 2 },
})

export interface SimulateRuleInput {
  orgId: string
  repoId: string
  ruleId: string
  workspacePath: string
  astGrepQuery: string
  language: string
}

export async function simulateRuleWorkflow(input: SimulateRuleInput): Promise<ImpactReportDoc> {
  return heavyActivities.simulateRuleBlastRadius(input)
}
