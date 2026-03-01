/**
 * Phase 6: Pattern Detection Workflow
 * Three-step pipeline: astGrepScan (heavy) → llmSynthesizeRules (light) → storePatterns (light)
 * Cleans up workspace filesystem after completion (K-01).
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as patternDetection from "../activities/pattern-detection"
import type * as workspaceCleanup from "../activities/workspace-cleanup"

const heavyActivities = proxyActivities<typeof patternDetection>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 2 },
})

const cleanupActivities = proxyActivities<typeof workspaceCleanup>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 1 },
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
  const result = await heavyActivities.scanSynthesizeAndStore({
    orgId: input.orgId,
    repoId: input.repoId,
    workspacePath: input.workspacePath,
    languages: input.languages,
  })

  // K-01: Clean up workspace filesystem after pattern detection completes.
  // This is the last workflow that needs the cloned source files.
  try {
    await cleanupActivities.cleanupWorkspaceFilesystem({
      orgId: input.orgId,
      repoId: input.repoId,
    })
  } catch {
    // Non-fatal — workspace will be cleaned up by scheduled cleanup
  }

  return result
}
