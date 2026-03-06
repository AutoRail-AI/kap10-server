/**
 * evictArtifactsWorkflow — Phase 13 (A-17).
 *
 * Daily cron workflow that cleans up expired artifacts:
 *   1. Stale SCIP indexes from Supabase Storage + Prisma
 *   2. Stale branch refs + ArangoDB scoped entities
 *   3. Stale workspaces (delegates to existing pruneStaleWorkspaces)
 *
 * Scheduled via Temporal ScheduleClient (A-18) at 3 AM UTC daily.
 * Queue: light-llm-queue (network I/O, no CPU-intensive work).
 *
 * Each activity runs independently — a failure in one doesn't block others.
 * The workflow is idempotent; re-running safely skips already-evicted items.
 */

import { proxyActivities } from "@temporalio/workflow"

import type * as evictionActivities from "../activities/artifact-eviction"
import type * as cleanupActivities from "../activities/workspace-cleanup"

const eviction = proxyActivities<typeof evictionActivities>({
  startToCloseTimeout: "10m",
  heartbeatTimeout: "60s",
  // Eviction is best-effort — 2 retries max, then wait for next daily run
  retry: { maximumAttempts: 2 },
})

const cleanup = proxyActivities<typeof cleanupActivities>({
  startToCloseTimeout: "5m",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 2 },
})

export interface EvictArtifactsInput {
  /** Override retention: primary SCIP index age in days (default: 30) */
  primaryRetentionDays?: number
  /** Override retention: workspace SCIP index age in days (default: 7) */
  workspaceRetentionDays?: number
  /** Override retention: stale branch ref age in days (default: 30) */
  branchStaleAfterDays?: number
  /** Override: stale workspace age in hours (default: 48, from pruneStaleWorkspaces) */
  workspaceMaxAgeHours?: number
  /** Dry run mode — log without deleting */
  dryRun?: boolean
}

export interface EvictArtifactsResult {
  scipIndexesDeleted: number
  storageFilesDeleted: number
  nearestCommitsDeleted: number
  branchRefsDeleted: number
  branchScopedEntitiesDeleted: number
  workspacesPruned: number
  errors: number
  durationMs: number
}

export async function evictArtifactsWorkflow(
  input?: EvictArtifactsInput,
): Promise<EvictArtifactsResult> {
  const ts = () => new Date().toISOString()
  const dryRun = input?.dryRun ?? false

  console.log(`[${ts()}] [INFO ] [wf:evict-artifacts] ━━━ EVICTION STARTED ━━━ ${dryRun ? "(DRY RUN)" : ""}`)
  const start = Date.now()

  let scipIndexesDeleted = 0
  let storageFilesDeleted = 0
  let nearestCommitsDeleted = 0
  let branchRefsDeleted = 0
  let branchScopedEntitiesDeleted = 0
  let workspacesPruned = 0
  let errors = 0

  // ── Phase 1: SCIP artifact eviction ─────────────────────────────────
  try {
    const scipResult = await eviction.evictStaleScipArtifacts({
      primaryRetentionDays: input?.primaryRetentionDays,
      workspaceRetentionDays: input?.workspaceRetentionDays,
      dryRun,
    })
    scipIndexesDeleted = scipResult.deleted
    storageFilesDeleted = scipResult.storageDeleted
    nearestCommitsDeleted = scipResult.nearestCommitsDeleted
    errors += scipResult.errors
    console.log(`[${ts()}] [INFO ] [wf:evict-artifacts] SCIP eviction: ${scipResult.deleted} indexes, ${scipResult.storageDeleted} files`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[${ts()}] [WARN ] [wf:evict-artifacts] SCIP eviction failed (non-fatal): ${msg}`)
    errors++
  }

  // ── Phase 2: Branch ref eviction ────────────────────────────────────
  try {
    const branchResult = await eviction.evictStaleBranchRefs({
      staleAfterDays: input?.branchStaleAfterDays,
      dryRun,
    })
    branchRefsDeleted = branchResult.branchRefsDeleted
    branchScopedEntitiesDeleted = branchResult.scopedEntitiesDeleted
    errors += branchResult.errors
    console.log(`[${ts()}] [INFO ] [wf:evict-artifacts] Branch eviction: ${branchResult.branchRefsDeleted} refs, ${branchResult.scopedEntitiesDeleted} entities`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[${ts()}] [WARN ] [wf:evict-artifacts] Branch eviction failed (non-fatal): ${msg}`)
    errors++
  }

  // ── Phase 3: Workspace pruning (B-09 — reuses existing activity) ───
  try {
    workspacesPruned = await cleanup.pruneStaleWorkspaces({
      maxAgeHours: input?.workspaceMaxAgeHours ?? 48,
    })
    console.log(`[${ts()}] [INFO ] [wf:evict-artifacts] Workspace pruning: ${workspacesPruned} pruned`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[${ts()}] [WARN ] [wf:evict-artifacts] Workspace pruning failed (non-fatal): ${msg}`)
    errors++
  }

  const durationMs = Date.now() - start
  console.log(
    `[${ts()}] [INFO ] [wf:evict-artifacts] ━━━ EVICTION COMPLETE ━━━ ` +
    `scip=${scipIndexesDeleted} branches=${branchRefsDeleted} workspaces=${workspacesPruned} ` +
    `errors=${errors} duration=${durationMs}ms`
  )

  return {
    scipIndexesDeleted,
    storageFilesDeleted,
    nearestCommitsDeleted,
    branchRefsDeleted,
    branchScopedEntitiesDeleted,
    workspacesPruned,
    errors,
    durationMs,
  }
}
