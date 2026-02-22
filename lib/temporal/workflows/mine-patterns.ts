/**
 * Phase 6: Pattern Mining Workflow — Louvain community detection.
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as mining from "../activities/pattern-mining"

const heavyActivities = proxyActivities<typeof mining>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "30m",
  heartbeatTimeout: "5m",
  retry: { maximumAttempts: 2 },
})

export interface MinePatternsInput {
  orgId: string
  repoId: string
  maxEntities?: number
}

export async function minePatternsWorkflow(input: MinePatternsInput): Promise<{
  communitiesFound: number
  patternsStored: number
}> {
  return heavyActivities.minePatterns({
    orgId: input.orgId,
    repoId: input.repoId,
    maxEntities: input.maxEntities ?? 50000,
  })
}
