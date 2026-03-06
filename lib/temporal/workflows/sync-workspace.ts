/**
 * syncWorkspaceWorkflow — Phase 13 (B-07): Lightweight workspace re-index.
 *
 * Unlike the full indexRepoWorkflow which wipes all graph data and runs
 * the 7-step pipeline (SCIP → tree-sitter → finalize → blast radius →
 * temporal analysis → embed → pattern detect), this workflow:
 *
 *   1. Diffs changed files between base and new commits
 *   2. Re-indexes the full worktree (V1 — no partial SCIP)
 *   3. Computes entity delta against primary entities
 *   4. Applies delta as workspace-scoped entities in ArangoDB
 *
 * NO blast radius, NO temporal analysis, NO embedding, NO pattern detection.
 * Workspace entities are ephemeral overlay data — they exist only to give
 * the developer's AI agent a view of their uncommitted changes.
 *
 * Typical execution time: 20-60s (vs 2-5 min for full pipeline).
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as workspaceSync from "../activities/workspace-sync"
import type * as pipelineLogs from "../activities/pipeline-logs"

const syncActivities = proxyActivities<typeof workspaceSync>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

const logActivities = proxyActivities<typeof pipelineLogs>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 1 },
})

/** Workflow-safe log (Temporal sandbox — no Node imports) */
function wfLog(level: string, msg: string, ctx: Record<string, unknown>) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:sync-workspace] [${ctx.orgId}/${ctx.repoId}] ${msg}`)
  logActivities.appendPipelineLog({
    timestamp: ts,
    level: level.toLowerCase() as "info" | "warn" | "error",
    phase: "workspace-sync",
    step: "",
    message: msg,
    meta: { repoId: String(ctx.repoId), scope: String(ctx.scope) },
  }).catch(() => {})
}

export interface SyncWorkspaceInput {
  orgId: string
  repoId: string
  /** Workspace user identifier from the git ref (e.g., "abc123def456") */
  keyId: string
  /** New commit SHA (after push) */
  commitSha: string
  /** Previous commit SHA (before push). Null = first sync (full delta). */
  baseSha: string | null
}

export interface SyncWorkspaceResult {
  entitiesWritten: number
  tombstonesCreated: number
  edgesWritten: number
  changedFiles: number
}

export async function syncWorkspaceWorkflow(input: SyncWorkspaceInput): Promise<SyncWorkspaceResult> {
  const scope = `workspace:${input.keyId}`
  const ctx = { orgId: input.orgId, repoId: input.repoId, scope }

  wfLog("INFO", `Workspace sync started — ${input.commitSha.slice(0, 8)} (base: ${input.baseSha?.slice(0, 8) ?? "none"})`, ctx)
  const pipelineStart = Date.now()

  // Step 1: Diff files (skip if first sync — no base to diff against)
  let changedFileCount = 0
  if (input.baseSha) {
    try {
      const diff = await syncActivities.workspaceDiff({
        orgId: input.orgId,
        repoId: input.repoId,
        baseSha: input.baseSha,
        newSha: input.commitSha,
      })
      changedFileCount = diff.totalChanged
      wfLog("INFO", `Diff: ${changedFileCount} files changed`, ctx)
    } catch (diffErr: unknown) {
      // Diff failure is non-fatal — proceed with full reindex
      const msg = diffErr instanceof Error ? diffErr.message : String(diffErr)
      wfLog("WARN", `Diff failed (proceeding with full delta): ${msg}`, ctx)
    }
  } else {
    wfLog("INFO", "First sync — no base commit, computing full delta", ctx)
  }

  // Step 2: Re-index and apply delta
  // The workspaceReindex activity handles:
  //   - Creating worktree (with try/finally cleanup)
  //   - Running SCIP + tree-sitter
  //   - Computing entity delta against primary
  //   - Applying delta as scoped entities
  const result = await syncActivities.workspaceReindex({
    orgId: input.orgId,
    repoId: input.repoId,
    commitSha: input.commitSha,
    scope,
    baseSha: input.baseSha,
  })

  const totalMs = Date.now() - pipelineStart
  const seconds = (totalMs / 1000).toFixed(1)
  wfLog("INFO", `Workspace sync complete in ${seconds}s — ${result.entitiesWritten} entities, ${result.tombstonesCreated} tombstones, ${result.edgesWritten} edges`, ctx)

  return {
    entitiesWritten: result.entitiesWritten,
    tombstonesCreated: result.tombstonesCreated,
    edgesWritten: result.edgesWritten,
    changedFiles: changedFileCount,
  }
}
