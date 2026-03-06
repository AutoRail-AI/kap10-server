/**
 * commitGraphUpdateWorkflow — Phase 13 (C-05): Post-index commit graph update.
 *
 * Triggered as a child workflow after a SCIP index upload completes.
 * Calls the commit graph pre-computation activity to populate the
 * NearestIndexedCommit cache for all reachable descendants.
 *
 * Short-lived: typically completes in 1-5 seconds.
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as commitGraphActivities from "../activities/commit-graph"
import type * as pipelineLogs from "../activities/pipeline-logs"

const graph = proxyActivities<typeof commitGraphActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
})

const logActivities = proxyActivities<typeof pipelineLogs>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 1 },
})

function wfLog(level: string, msg: string, ctx: Record<string, unknown>) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:commit-graph-update] [${ctx.orgId}/${ctx.repoId}] ${msg}`)
  logActivities.appendPipelineLog({
    timestamp: ts,
    level: level.toLowerCase() as "info" | "warn" | "error",
    phase: "commit-graph",
    step: "",
    message: msg,
    meta: { repoId: String(ctx.repoId) },
  }).catch(() => {})
}

export interface CommitGraphUpdateInput {
  orgId: string
  repoId: string
  indexedSha: string
}

export async function commitGraphUpdateWorkflow(input: CommitGraphUpdateInput): Promise<{ updated: number }> {
  const ctx = { orgId: input.orgId, repoId: input.repoId }

  wfLog("INFO", `Pre-computing commit graph for indexed commit ${input.indexedSha.slice(0, 8)}`, ctx)

  const result = await graph.preComputeCommitGraph({
    orgId: input.orgId,
    repoId: input.repoId,
    indexedSha: input.indexedSha,
  })

  wfLog("INFO", `Commit graph updated: ${result.updated} cache entries written`, ctx)

  return { updated: result.updated }
}
