/**
 * Phase 10a: syncLocalGraphWorkflow — exports graph to msgpack and uploads to Supabase Storage.
 *
 * Workflow ID: sync-{orgId}-{repoId} (idempotent)
 * Queue: light-llm-queue
 *
 * Steps:
 *   1. Set snapshot status to "generating"
 *   2. Query + compact all entities and edges from ArangoDB
 *   3. Serialize to msgpack buffer + compute checksum
 *   4. Upload to Supabase Storage + update metadata
 *   5. Notify connected clients via cache/pub-sub
 *
 * On failure: set snapshot status to "failed"
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as graphExport from "../activities/graph-export"
import type * as graphUpload from "../activities/graph-upload"

const exportActivities = proxyActivities<typeof graphExport>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "10m",
  heartbeatTimeout: "2m",
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

    // Step 2: Query + compact graph from ArangoDB (v2: includes rules + patterns)
    const { entities, edges, rules, patterns } = await exportActivities.queryCompactGraph({
      orgId: input.orgId,
      repoId: input.repoId,
    })

    // Step 3: Serialize to msgpack (v2 envelope when rules/patterns present)
    const { buffer, checksum, entityCount, edgeCount } =
      await exportActivities.serializeToMsgpack({
        repoId: input.repoId,
        orgId: input.orgId,
        entities,
        edges,
        rules,
        patterns,
      })

    // Step 4: Upload to Supabase Storage
    const { storagePath, sizeBytes } = await uploadActivities.uploadToStorage({
      orgId: input.orgId,
      repoId: input.repoId,
      buffer,
      checksum,
      entityCount,
      edgeCount,
    })

    // Step 5: Notify connected clients
    await uploadActivities.notifyConnectedClients({
      orgId: input.orgId,
      repoId: input.repoId,
    })

    return { storagePath, sizeBytes, entityCount, edgeCount, checksum }
  } catch (err: unknown) {
    // Set failed status on error
    await uploadActivities.updateSnapshotStatus({
      orgId: input.orgId,
      repoId: input.repoId,
      status: "failed",
    })
    throw err
  }
}
