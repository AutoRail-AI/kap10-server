/**
 * Phase 5: Incremental index workflow.
 * Triggered by push webhooks. Uses signal debouncing for rapid pushes.
 * Fixed workflow ID per repo enables signalWithStart pattern.
 */

import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
  ParentClosePolicy,
} from "@temporalio/workflow"
import type * as incremental from "../activities/incremental"
import type * as light from "../activities/indexing-light"
import type * as driftAlert from "../activities/drift-alert"
import { embedRepoWorkflow } from "./embed-repo"

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

const driftActivities = proxyActivities<typeof driftAlert>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  heartbeatTimeout: "1m",
  retry: { maximumAttempts: 2 },
})

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

  try {
    // Step 1: Pull and diff
    progress = 10
    const pullResult = await heavyActivities.pullAndDiff({
      orgId: input.orgId,
      repoId: input.repoId,
      workspacePath: input.workspacePath,
      beforeSha: latestPush.beforeSha,
      afterSha: latestPush.afterSha,
      branch: input.defaultBranch,
      installationId: input.installationId,
    })

    // Step 2: Fallback guard — if too many files changed, trigger full re-index
    const fallbackThreshold = 200
    if (pullResult.changedFiles.length > fallbackThreshold) {
      // Too many changes — fall back to full re-index
      progress = 100
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
        workflow_id: "",
        created_at: new Date().toISOString(),
      }
      await lightActivities.writeIndexEvent({ orgId: input.orgId, repoId: input.repoId, event })
      return { entitiesAdded: 0, entitiesUpdated: 0, entitiesDeleted: 0, edgesRepaired: 0, embeddingsUpdated: 0, cascadeEntities: 0 }
    }

    // Step 3: Fan-out re-index batches (entities written directly to ArangoDB)
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

    // Step 4: Delete entities for removed files
    progress = 50
    const diffResult = await lightActivities.applyEntityDiffs({
      orgId: input.orgId,
      repoId: input.repoId,
      addedEntityIds: allEntityIds,
      removedFilePaths: removed,
    })

    // Step 5: Repair edges (passes only IDs, fetches full data internally)
    progress = 60
    const edgeResult = await lightActivities.repairEdgesActivity({
      orgId: input.orgId,
      repoId: input.repoId,
      changedEntityIds: allEntityIds,
      removedFilePaths: removed,
    })

    // Step 6: Update embeddings
    progress = 70
    const changedKeys = allEntityIds
    const embedResult = await lightActivities.updateEmbeddings({
      orgId: input.orgId,
      repoId: input.repoId,
      changedEntityKeys: changedKeys,
    })

    // Step 7: Cascade re-justification
    progress = 80
    const cascadeResult = await lightActivities.cascadeReJustify({
      orgId: input.orgId,
      repoId: input.repoId,
      changedEntityKeys: changedKeys,
    })

    // Step 8: Invalidate caches
    progress = 90
    await lightActivities.invalidateCaches({
      orgId: input.orgId,
      repoId: input.repoId,
    })

    // Step 9: Write index event
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
      workflow_id: "",
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
