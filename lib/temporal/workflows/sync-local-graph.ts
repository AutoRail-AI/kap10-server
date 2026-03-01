/**
 * Phase 10a: syncLocalGraphWorkflow — exports graph to msgpack and uploads to Supabase Storage.
 *
 * Workflow ID: sync-{orgId}-{repoId} (idempotent)
 * Queue: light-llm-queue
 *
 * Steps:
 *   1. Set snapshot status to "generating"
 *   2. Single activity: query graph → serialize → upload → upsert metadata
 *      (buffer never crosses Temporal's gRPC boundary)
 *   3. Notify connected clients via cache/pub-sub
 *
 * On failure: set snapshot status to "failed"
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as graphExport from "../activities/graph-export"
import type * as graphUpload from "../activities/graph-upload"

const exportActivities = proxyActivities<typeof graphExport>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "10m",
  heartbeatTimeout: "5m", // K-13: Increased from 2m for large-repo tolerance
  retry: { maximumAttempts: 3 },
})

const uploadActivities = proxyActivities<typeof graphUpload>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  heartbeatTimeout: "1m",
  retry: { maximumAttempts: 3 },
})

export interface SyncLocalGraphInput {
  orgId: string
  repoId: string
}

export async function syncLocalGraphWorkflow(input: SyncLocalGraphInput): Promise<{
  storagePath: string
  sizeBytes: number
  entityCount: number
  edgeCount: number
  checksum: string
}> {
  try {
    // Step 1: Set status to "generating"
    await uploadActivities.updateSnapshotStatus({
      orgId: input.orgId,
      repoId: input.repoId,
      status: "generating",
    })

    // Step 2: Query + serialize + upload in a single activity.
    // The buffer stays inside the worker and never crosses Temporal's
    // 4MB gRPC message limit.
    const { storagePath, sizeBytes, checksum, entityCount, edgeCount } =
      await exportActivities.exportAndUploadGraph({
        orgId: input.orgId,
        repoId: input.repoId,
      })

    // Step 3: Notify connected clients
    await uploadActivities.notifyConnectedClients({
      orgId: input.orgId,
      repoId: input.repoId,
    })

    return { storagePath, sizeBytes, entityCount, edgeCount, checksum }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[wf:sync-local-graph] [${input.orgId}/${input.repoId}] Snapshot export failed: ${message}`)

    // Set failed status — best-effort (don't mask the original error)
    try {
      await uploadActivities.updateSnapshotStatus({
        orgId: input.orgId,
        repoId: input.repoId,
        status: "failed",
      })
    } catch {
      console.error(`[wf:sync-local-graph] [${input.orgId}/${input.repoId}] Failed to update snapshot status to "failed"`)
    }
    throw err
  }
}
