/**
 * Phase 6: Pattern Detection Workflow
 * Three-step pipeline: astGrepScan (heavy) → llmSynthesizeRules (light) → storePatterns (light)
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as patternDetection from "../activities/pattern-detection"

const heavyActivities = proxyActivities<typeof patternDetection>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 2 },
})

export interface DetectPatternsInput {
  orgId: string
  repoId: string
  workspacePath: string
  languages: string[]
}

export async function detectPatternsWorkflow(input: DetectPatternsInput): Promise<{
  patternsDetected: number
  rulesGenerated: number
}> {
  // Combined: scan + synthesize + store (all in one activity — no large payloads in workflow)
  return heavyActivities.scanSynthesizeAndStore({
    orgId: input.orgId,
    repoId: input.repoId,
    workspacePath: input.workspacePath,
    languages: input.languages,
  })
}
