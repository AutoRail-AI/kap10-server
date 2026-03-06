/**
 * Phase 5: Incremental index workflow.
 * Triggered by push webhooks. Uses signal debouncing for rapid pushes.
 * Fixed workflow ID per repo enables signalWithStart pattern.
 */

import {
  condition,
  defineQuery,
  defineSignal,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
  startChild,
  workflowInfo,
} from "@temporalio/workflow"
import { indexRepoWorkflow } from "./index-repo"
import type * as contextRefresh from "../activities/context-refresh"
import type * as incremental from "../activities/incremental"
import type * as light from "../activities/indexing-light"
import type * as pipelineLogs from "../activities/pipeline-logs"

const heavyActivities = proxyActivities<typeof incremental>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "30m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

const lightActivities = proxyActivities<
  Pick<typeof incremental, "applyEntityDiffs" | "repairEdgesActivity" | "updateEmbeddings" | "cascadeReJustify" | "invalidateCaches" | "writeIndexEvent">
>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "10m",
  heartbeatTimeout: "1m",
  retry: { maximumAttempts: 3 },
})

const lightWriteActivities = proxyActivities<Pick<typeof light, "writeToArango" | "finalizeIndexing" | "updateRepoError">>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  heartbeatTimeout: "1m",
  retry: { maximumAttempts: 3 },
})

const contextRefreshActivities = proxyActivities<typeof contextRefresh>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  heartbeatTimeout: "1m",
  retry: { maximumAttempts: 2 },
})

const logActivities = proxyActivities<typeof pipelineLogs>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 1 },
})

/** Workflow-safe log helper (Temporal sandbox — no require/import of Node modules) */
function wfLog(level: string, msg: string, ctx: Record<string, unknown>, step?: string) {
  const ts = new Date().toISOString()
  const orgId = ctx.organizationId ?? "-"
  const repoId = ctx.repoId ?? "-"
  const runId = ctx.runId as string | undefined
  const extra = { ...ctx }
  delete extra.organizationId
  delete extra.repoId
  delete extra.runId
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : ""
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:incremental-index] [${orgId}/${repoId}] ${msg}${extraStr}`)

  logActivities
    .appendPipelineLog({
      timestamp: ts,
      level: level.toLowerCase() as "info" | "warn" | "error",
      phase: "indexing",
      step: step ?? "",
      message: msg,
      meta: { ...extra, repoId: String(repoId), ...(runId && { runId }) },
    })
    .catch(() => {})
}

// Signals and queries
export const pushSignal = defineSignal<[{ afterSha: string; beforeSha: string; ref: string; commitMessage?: string }]>("push")
export const getIncrementalProgress = defineQuery<number>("getIncrementalProgress")

export interface IncrementalIndexInput {
  orgId: string
  repoId: string
  installationId: number
  cloneUrl: string
  defaultBranch: string
  workspacePath: string
  runId?: string
  initialPush: {
    afterSha: string
    beforeSha: string
    ref: string
    commitMessage?: string
  }
}

export async function incrementalIndexWorkflow(input: IncrementalIndexInput): Promise<{
  entitiesAdded: number
  entitiesUpdated: number
  entitiesDeleted: number
  edgesRepaired: number
  embeddingsUpdated: number
  cascadeEntities: number
}> {
  let progress = 0
  setHandler(getIncrementalProgress, () => progress)

  // Signal debouncing: collect push signals during quiet period
  let latestPush = input.initialPush
  let pendingSignal = false

  setHandler(pushSignal, (signal) => {
    latestPush = signal
    pendingSignal = true
  })

  // Wait for quiet period (debounce rapid pushes)
  const quietPeriodStr = "60s" // Workflow cannot access env, hardcode default
  const quietMs = parseQuietPeriod(quietPeriodStr)

  // Debounce loop: wait until no new signals arrive within quiet period
  let debounceComplete = false
  while (!debounceComplete) {
    pendingSignal = false
    const timedOut = await condition(() => pendingSignal, quietMs)
    if (!timedOut) {
      // Quiet period expired without new signals — proceed
      debounceComplete = true
    }
    // If a signal arrived, loop again to reset the quiet period
  }

  const startTime = Date.now()
  const wfId = workflowInfo().workflowId
  const ctx = { organizationId: input.orgId, repoId: input.repoId, runId: input.runId }

  wfLog("INFO", "Incremental index started", { ...ctx, afterSha: latestPush.afterSha, commitMessage: latestPush.commitMessage }, "Start")

  try {
    // Step 1: Pull and diff
    progress = 10
    wfLog("INFO", "Step 1/10: Pulling and computing diff", ctx, "Step 1/10")
    const pullResult = await heavyActivities.pullAndDiff({
      orgId: input.orgId,
      repoId: input.repoId,
      workspacePath: input.workspacePath,
      beforeSha: latestPush.beforeSha,
      afterSha: latestPush.afterSha,
      branch: input.defaultBranch,
      installationId: input.installationId,
    })

    wfLog("INFO", `Step 1 complete: ${pullResult.changedFiles.length} files changed`, { ...ctx, changedFiles: pullResult.changedFiles.length }, "Step 1/10")

    // Step 2: Fallback guard — if too many files changed, trigger full re-index
    const fallbackThreshold = 200
    if (pullResult.changedFiles.length > fallbackThreshold) {
      wfLog("WARN", `Fallback to full re-index: ${pullResult.changedFiles.length} files exceed threshold (${fallbackThreshold})`, { ...ctx, changedFiles: pullResult.changedFiles.length, threshold: fallbackThreshold }, "Fallback")
      // D-01: Too many changes — auto-trigger full re-index as a child workflow
      const event = {
        org_id: input.orgId,
        repo_id: input.repoId,
        push_sha: latestPush.afterSha,
        commit_message: latestPush.commitMessage ?? "",
        event_type: "force_push_reindex" as const,
        files_changed: pullResult.changedFiles.length,
        entities_added: 0,
        entities_updated: 0,
        entities_deleted: 0,
        edges_repaired: 0,
        embeddings_updated: 0,
        cascade_status: "skipped" as const,
        cascade_entities: 0,
        duration_ms: Date.now() - startTime,
        workflow_id: wfId,
        created_at: new Date().toISOString(),
      }
      await lightActivities.writeIndexEvent({ orgId: input.orgId, repoId: input.repoId, event })

      // Fire-and-forget full re-index — ABANDON so the child survives if this workflow completes
      try {
        await startChild(indexRepoWorkflow, {
          workflowId: `index-${input.orgId}-${input.repoId}-fallback-${workflowInfo().runId.slice(0, 8)}`,
          taskQueue: "heavy-compute-queue",
          args: [{
            orgId: input.orgId,
            repoId: input.repoId,
            provider: "github" as const,
            installationId: input.installationId,
            cloneUrl: input.cloneUrl,
            defaultBranch: input.defaultBranch,
            runId: input.runId,
          }],
          parentClosePolicy: ParentClosePolicy.ABANDON,
        })
      } catch (childErr: unknown) {
        const msg = childErr instanceof Error ? childErr.message : String(childErr)
        if (msg.includes("already started") || msg.includes("already exists")) {
          wfLog("WARN", "Fallback re-index workflow already running, skipping duplicate", ctx, "Fallback")
        } else {
          throw childErr
        }
      }

      progress = 100
      return { entitiesAdded: 0, entitiesUpdated: 0, entitiesDeleted: 0, edgesRepaired: 0, embeddingsUpdated: 0, cascadeEntities: 0 }
    }

    // Step 3: Fan-out re-index batches (entities written directly to ArangoDB)
    wfLog("INFO", "Step 3/10: Re-indexing changed files in batches", { ...ctx, addedOrModified: pullResult.changedFiles.filter((f: { changeType: string }) => f.changeType !== "removed").length, removed: pullResult.changedFiles.filter((f: { changeType: string }) => f.changeType === "removed").length }, "Step 3/10")
    progress = 30
    const addedOrModified = pullResult.changedFiles
      .filter((f) => f.changeType !== "removed")
      .map((f) => f.path)
    const removed = pullResult.changedFiles
      .filter((f) => f.changeType === "removed")
      .map((f) => f.path)

    const batchSize = 5
    const reindexResults = []
    for (let i = 0; i < addedOrModified.length; i += batchSize) {
      const batch = addedOrModified.slice(i, i + batchSize)
      const result = await heavyActivities.reIndexBatch({
        orgId: input.orgId,
        repoId: input.repoId,
        workspacePath: input.workspacePath,
        filePaths: batch,
      })
      reindexResults.push(result)
    }

    // Collect lightweight IDs and quarantine info (no full entities in workflow)
    const allEntityIds = reindexResults.flatMap((r) => r.entityIds)
    const allQuarantined = reindexResults.flatMap((r) => r.quarantined)

    wfLog("INFO", `Step 3 complete: ${allEntityIds.length} entities re-indexed, ${allQuarantined.length} quarantined`, { ...ctx, entityCount: allEntityIds.length, quarantined: allQuarantined.length }, "Step 3/10")

    // Step 4: Delete entities for removed files
    wfLog("INFO", "Step 4/10: Applying entity diffs", ctx, "Step 4/10")
    progress = 50
    const diffResult = await lightActivities.applyEntityDiffs({
      orgId: input.orgId,
      repoId: input.repoId,
      addedEntityIds: allEntityIds,
      removedFilePaths: removed,
    })

    wfLog("INFO", `Step 4 complete: +${diffResult.entitiesAdded} -${diffResult.entitiesDeleted} ~${diffResult.entitiesUpdated} entities`, { ...ctx, added: diffResult.entitiesAdded, deleted: diffResult.entitiesDeleted, updated: diffResult.entitiesUpdated }, "Step 4/10")

    // Step 5: Repair edges (passes only IDs, fetches full data internally)
    wfLog("INFO", "Step 5/10: Repairing edges", ctx, "Step 5/10")
    progress = 60
    const edgeResult = await lightActivities.repairEdgesActivity({
      orgId: input.orgId,
      repoId: input.repoId,
      changedEntityIds: allEntityIds,
      removedFilePaths: removed,
    })

    // Step 6: Update embeddings
    wfLog("INFO", "Step 6/10: Updating embeddings", ctx, "Step 6/10")
    progress = 70
    const changedKeys = allEntityIds
    const embedResult = await lightActivities.updateEmbeddings({
      orgId: input.orgId,
      repoId: input.repoId,
      changedEntityKeys: changedKeys,
    })

    // Step 7: Cascade re-justification
    wfLog("INFO", "Step 7/10: Cascading re-justification", ctx, "Step 7/10")
    progress = 80
    const cascadeResult = await lightActivities.cascadeReJustify({
      orgId: input.orgId,
      repoId: input.repoId,
      changedEntityKeys: changedKeys,
    })

    // Step 7.5 (J-03): Incremental context refresh — update knowledge document sections
    try {
      await contextRefreshActivities.refreshKnowledgeSections({
        orgId: input.orgId,
        repoId: input.repoId,
        changedEntityCount: allEntityIds.length,
        addedEntityCount: diffResult.entitiesAdded,
        deletedEntityCount: diffResult.entitiesDeleted,
        cascadeEntityCount: cascadeResult.cascadeEntities,
      })
    } catch (refreshErr: unknown) {
      const refreshMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
      wfLog("WARN", `Context refresh failed (non-fatal): ${refreshMsg}`, ctx, "Step 7.5")
    }

    // Step 8: Invalidate caches
    wfLog("INFO", "Step 8/10: Invalidating caches", ctx, "Step 8/10")
    progress = 90
    await lightActivities.invalidateCaches({
      orgId: input.orgId,
      repoId: input.repoId,
    })

    // Step 9: Write index event
    wfLog("INFO", "Step 9/10: Writing index event", ctx, "Step 9/10")
    const event = {
      org_id: input.orgId,
      repo_id: input.repoId,
      push_sha: latestPush.afterSha,
      commit_message: latestPush.commitMessage ?? "",
      event_type: "incremental" as const,
      files_changed: pullResult.changedFiles.length,
      entities_added: diffResult.entitiesAdded,
      entities_updated: diffResult.entitiesUpdated,
      entities_deleted: diffResult.entitiesDeleted,
      edges_repaired: edgeResult.edgesDeleted,
      embeddings_updated: embedResult.embeddingsUpdated,
      cascade_status: cascadeResult.cascadeStatus,
      cascade_entities: cascadeResult.cascadeEntities,
      duration_ms: Date.now() - startTime,
      workflow_id: wfId,
      extraction_errors: allQuarantined.length > 0
        ? allQuarantined.map((q) => ({ filePath: q.filePath, reason: q.reason, quarantined: true }))
        : undefined,
      created_at: new Date().toISOString(),
    }
    await lightActivities.writeIndexEvent({ orgId: input.orgId, repoId: input.repoId, event })

    // Step 10: Finalize status
    await lightWriteActivities.finalizeIndexing({
      orgId: input.orgId,
      repoId: input.repoId,
      fileCount: 0,
      functionCount: 0,
      classCount: 0,
    })

    progress = 100
    const durationMs = Date.now() - startTime

    wfLog("INFO", `Incremental index complete — +${diffResult.entitiesAdded} -${diffResult.entitiesDeleted} ~${diffResult.entitiesUpdated} entities, ${edgeResult.edgesDeleted} edges repaired, ${embedResult.embeddingsUpdated} embeddings updated (${durationMs}ms)`, {
      ...ctx,
      entitiesAdded: diffResult.entitiesAdded,
      entitiesUpdated: diffResult.entitiesUpdated,
      entitiesDeleted: diffResult.entitiesDeleted,
      edgesRepaired: edgeResult.edgesDeleted,
      embeddingsUpdated: embedResult.embeddingsUpdated,
      cascadeEntities: cascadeResult.cascadeEntities,
      durationMs,
    }, "Complete")

    return {
      entitiesAdded: diffResult.entitiesAdded,
      entitiesUpdated: diffResult.entitiesUpdated,
      entitiesDeleted: diffResult.entitiesDeleted,
      edgesRepaired: edgeResult.edgesDeleted,
      embeddingsUpdated: embedResult.embeddingsUpdated,
      cascadeEntities: cascadeResult.cascadeEntities,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const elapsedMs = Date.now() - startTime
    wfLog("ERROR", `Incremental index failed after ${elapsedMs}ms`, { ...ctx, errorMessage: message, elapsedMs }, "Error")
    await lightWriteActivities.updateRepoError(input.repoId, `Incremental index failed: ${message}`)
    throw err
  }
}

function parseQuietPeriod(s: string): number {
  const match = s.match(/^(\d+)(ms|s|m)$/)
  if (!match) return 60000
  const value = parseInt(match[1]!, 10)
  switch (match[2]) {
    case "ms": return value
    case "s": return value * 1000
    case "m": return value * 60 * 1000
    default: return 60000
  }
}
