/**
 * Phase 4: justifyEntityWorkflow — single-entity re-justification.
 *
 * Workflow ID: justify-entity-{orgId}-{entityId}
 * Queue: light-llm-queue
 *
 * Used by Phase 5 incremental indexing when a single entity changes.
 *
 * Steps:
 *   1. Fetch entity/edge counts to validate entity exists
 *   2. Load ontology
 *   3. Justify the single entity (fetches data internally, stores result)
 *   4. Embed justifications
 *   5. Cascade: justify direct callers
 *   6. Update feature aggregations
 *
 * Activities are self-sufficient — they fetch data from ArangoDB directly.
 * Only small references (IDs, counts) cross the Temporal serialization boundary.
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as justificationActivities from "../activities/justification"

const activities = proxyActivities<typeof justificationActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "10m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

export interface JustifyEntityInput {
  orgId: string
  repoId: string
  entityId: string
}

export async function justifyEntityWorkflow(input: JustifyEntityInput): Promise<{
  justified: boolean
  cascadeCount: number
}> {
  const justificationInput = { orgId: input.orgId, repoId: input.repoId }

  // Step 1: Validate the entity exists by checking counts
  const { entityCount } = await activities.fetchEntitiesAndEdges(justificationInput)

  if (entityCount === 0) {
    return { justified: false, cascadeCount: 0 }
  }

  // Step 2: Load ontology (small payload)
  await activities.loadOntology(justificationInput)

  // Step 3: Justify the single entity (fetches context + stores internally)
  const { justifiedCount } = await activities.justifyBatch(justificationInput, [input.entityId])

  if (justifiedCount === 0) {
    return { justified: false, cascadeCount: 0 }
  }

  // Step 4: Embed justifications (fetches from ArangoDB)
  await activities.embedJustifications(justificationInput)

  // Step 5: Cascade — justify direct callers
  // findEntityCallerIds runs topological sort internally and returns only the
  // caller IDs for the next level up — keeps the Temporal payload small.
  let cascadeCount = 0
  const callerIds = await activities.findEntityCallerIds(justificationInput, input.entityId)
  if (callerIds.length > 0) {
    const cascadeResult = await activities.justifyBatch(justificationInput, callerIds)
    cascadeCount = cascadeResult.justifiedCount

    if (cascadeCount > 0) {
      await activities.embedJustifications(justificationInput)
    }
  }

  // Step 6: Update feature aggregations (fetches justifications from ArangoDB)
  await activities.storeFeatureAggregations(justificationInput)

  return { justified: true, cascadeCount }
}
