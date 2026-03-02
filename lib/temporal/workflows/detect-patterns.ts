/**
 * Phase 6: Pattern Detection Workflow
 * Step 1: astGrepScan + llmSynthesizeRules + storePatterns (heavy-compute-queue)
 * Step 2: L-13 semantic pattern mining (light-llm-queue, needs LLM)
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

const lightActivities = proxyActivities<typeof patternDetection>({
  taskQueue: "light-llm-queue",
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
  semanticClusters: number
  semanticRules: number
}> {
  // Step 1: Combined scan + synthesize + store (all in one activity — no large payloads in workflow)
  const result = await heavyActivities.scanSynthesizeAndStore({
    orgId: input.orgId,
    repoId: input.repoId,
    workspacePath: input.workspacePath,
    languages: input.languages,
  })

  // Step 2: L-13 semantic pattern mining (best-effort)
  let semanticResult = { clustersFound: 0, rulesGenerated: 0 }
  try {
    semanticResult = await lightActivities.semanticPatternMining({
      orgId: input.orgId,
      repoId: input.repoId,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[${new Date().toISOString()}] [WARN ] [wf:detect-patterns] [${input.orgId}/${input.repoId}] Semantic mining failed (non-fatal): ${msg}`)
  }

  // K-01: Clean up workspace filesystem after pattern detection completes.
  // This is the last workflow that needs the cloned source files.
  try {
    await cleanupActivities.cleanupWorkspaceFilesystem({
      orgId: input.orgId,
      repoId: input.repoId,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[${new Date().toISOString()}] [WARN ] [wf:detect-patterns] [${input.orgId}/${input.repoId}] Workspace cleanup failed (non-fatal): ${msg}`)
  }

  return {
    ...result,
    semanticClusters: semanticResult.clustersFound,
    semanticRules: semanticResult.rulesGenerated,
  }
}
