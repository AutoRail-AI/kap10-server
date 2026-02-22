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

const lightActivities = proxyActivities<typeof patternDetection>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  heartbeatTimeout: "1m",
  retry: { maximumAttempts: 3 },
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
  // Step 1: AST-grep scan (heavy — CPU-bound tree-sitter parsing)
  const scanResult = await heavyActivities.astGrepScan({
    orgId: input.orgId,
    repoId: input.repoId,
    workspacePath: input.workspacePath,
    languages: input.languages,
  })

  if (scanResult.detectedPatterns.length === 0) {
    return { patternsDetected: 0, rulesGenerated: 0 }
  }

  // Step 2: LLM synthesis (light — network-bound)
  const synthesizeResult = await lightActivities.llmSynthesizeRules({
    orgId: input.orgId,
    repoId: input.repoId,
    detectedPatterns: scanResult.detectedPatterns,
  })

  // Step 3: Store patterns and rules (light — DB writes)
  const storeResult = await lightActivities.storePatterns({
    orgId: input.orgId,
    repoId: input.repoId,
    detectedPatterns: scanResult.detectedPatterns,
    synthesizedRules: synthesizeResult.synthesizedRules,
  })

  return {
    patternsDetected: storeResult.patternsStored,
    rulesGenerated: storeResult.rulesStored,
  }
}
