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
  runId?: string
  workspacePath: string
  languages: string[]
}

export async function detectPatternsWorkflow(input: DetectPatternsInput): Promise<{
  patternsDetected: number
  rulesGenerated: number
  semanticClusters: number
  semanticRules: number
}> {
  const workflowStart = Date.now()
  const tag = `[wf:detect-patterns] [${input.orgId}/${input.repoId}]`
  const ts = () => new Date().toISOString()
  console.log(`[${ts()}] [INFO ] ${tag} ━━━ PATTERN DETECTION STARTED ━━━ languages: ${input.languages.join(", ")}`)

  // Step 1: Combined scan + synthesize + store (all in one activity — no large payloads in workflow)
  const step1Start = Date.now()
  console.log(`[${ts()}] [INFO ] ${tag} Step 1/3: Scanning, synthesizing, and storing patterns`)
  const result = await heavyActivities.scanSynthesizeAndStore({
    orgId: input.orgId,
    repoId: input.repoId,
    runId: input.runId,
    workspacePath: input.workspacePath,
    languages: input.languages,
  })
  const step1Ms = Date.now() - step1Start
  console.log(`[${ts()}] [INFO ] ${tag} Step 1 complete: ${result.patternsDetected} patterns, ${result.rulesGenerated} rules (${step1Ms}ms)`)

  // Step 2: L-13 semantic pattern mining (best-effort)
  const step2Start = Date.now()
  console.log(`[${ts()}] [INFO ] ${tag} Step 2/3: Semantic pattern mining`)
  let semanticResult = { clustersFound: 0, rulesGenerated: 0 }
  try {
    semanticResult = await lightActivities.semanticPatternMining({
      orgId: input.orgId,
      repoId: input.repoId,
    })
    const step2Ms = Date.now() - step2Start
    console.log(`[${ts()}] [INFO ] ${tag} Step 2 complete: ${semanticResult.clustersFound} clusters, ${semanticResult.rulesGenerated} rules (${step2Ms}ms)`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const step2Ms = Date.now() - step2Start
    console.log(`[${ts()}] [WARN ] ${tag} Semantic mining failed (non-fatal, ${step2Ms}ms): ${msg}`)
  }

  // K-01: Clean up workspace filesystem after pattern detection completes.
  // This is the last workflow that needs the cloned source files.
  const step3Start = Date.now()
  console.log(`[${ts()}] [INFO ] ${tag} Step 3/3: Cleaning up workspace filesystem`)
  try {
    await cleanupActivities.cleanupWorkspaceFilesystem({
      orgId: input.orgId,
      repoId: input.repoId,
    })
    const step3Ms = Date.now() - step3Start
    console.log(`[${ts()}] [INFO ] ${tag} Workspace cleanup complete (${step3Ms}ms)`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const step3Ms = Date.now() - step3Start
    console.log(`[${ts()}] [WARN ] ${tag} Workspace cleanup failed (non-fatal, ${step3Ms}ms): ${msg}`)
  }

  const totalMs = Date.now() - workflowStart
  console.log(`[${ts()}] [INFO ] ${tag} ━━━ PATTERN DETECTION COMPLETE ━━━ ${result.patternsDetected} patterns, ${result.rulesGenerated} rules, ${semanticResult.clustersFound} semantic clusters in ${Math.round(totalMs / 1000)}s`)

  return {
    ...result,
    semanticClusters: semanticResult.clustersFound,
    semanticRules: semanticResult.rulesGenerated,
  }
}
