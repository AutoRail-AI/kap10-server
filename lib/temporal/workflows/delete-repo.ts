/**
 * Delete repo workflow — removes all data across every store.
 *
 * Workflow ID: delete-{orgId}-{repoId}
 * Queue: light-llm-queue
 *
 * Cleans up:
 *   - ArangoDB: 22 doc + 8 edge collections
 *   - Redis: entity profiles, topo levels, pipeline logs, sync keys
 *   - Supabase Storage: graph snapshots, pipeline log archives
 *   - Filesystem: /data/repo-indices/{orgId}/{repoId}
 *   - PostgreSQL: repo record + CASCADE (embeddings, pipeline_runs, api_keys, etc.)
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as light from "../activities/indexing-light"

const lightActivities = proxyActivities<typeof light>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
})

export interface DeleteRepoInput {
  orgId: string
  repoId: string
}

export async function deleteRepoWorkflow(input: DeleteRepoInput): Promise<void> {
  const start = Date.now()
  console.log(`[${new Date().toISOString()}] [INFO ] [wf:delete-repo] [${input.orgId}/${input.repoId}] ━━━ DELETE STARTED ━━━`)

  await lightActivities.deleteRepoData(input)

  const totalMs = Date.now() - start
  console.log(`[${new Date().toISOString()}] [INFO ] [wf:delete-repo] [${input.orgId}/${input.repoId}] ━━━ DELETE COMPLETE ━━━ (${totalMs}ms)`)
}
