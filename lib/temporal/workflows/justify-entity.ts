/**
 * Phase 4: justifyEntityWorkflow — single-entity re-justification.
 *
 * Workflow ID: justify-entity-{orgId}-{entityId}
 * Queue: light-llm-queue
 *
 * Used by Phase 5 incremental indexing when a single entity changes.
 *
 * Steps:
 *   1. Justify the single entity (fetch context, classify, store)
 *   2. Embed the justification
 *   3. Evaluate cascade: re-justify callers if taxonomy changed
 *   4. Update feature aggregation for affected features
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
  // Step 1: Fetch entity's context (edges, ontology, neighbors)
  const { entities, edges } = await activities.fetchEntitiesAndEdges({
    orgId: input.orgId,
    repoId: input.repoId,
  })

  const entity = entities.find((e) => e.id === input.entityId)
  if (!entity) {
    return { justified: false, cascadeCount: 0 }
  }

  // Step 2: Load ontology
  const ontology = await activities.loadOntology({
    orgId: input.orgId,
    repoId: input.repoId,
  })

  // Step 3: Justify the single entity
  const justifications = await activities.justifyBatch(
    { orgId: input.orgId, repoId: input.repoId },
    [entity],
    edges,
    ontology,
    [] // No previous justifications needed for single entity
  )

  if (justifications.length === 0) {
    return { justified: false, cascadeCount: 0 }
  }

  // Step 4: Store the justification
  await activities.storeJustifications(
    { orgId: input.orgId, repoId: input.repoId },
    justifications
  )

  // Step 5: Embed the justification
  await activities.embedJustifications(
    { orgId: input.orgId, repoId: input.repoId },
    justifications
  )

  // Step 6: Evaluate cascade — re-justify direct callers
  const callerEntities = entities.filter((e) =>
    edges.some(
      (edge) =>
        edge._from.endsWith(`/${e.id}`) &&
        edge._to.endsWith(`/${input.entityId}`) &&
        edge.kind === "calls"
    )
  )

  let cascadeCount = 0
  if (callerEntities.length > 0) {
    const cascadeJustifications = await activities.justifyBatch(
      { orgId: input.orgId, repoId: input.repoId },
      callerEntities,
      edges,
      ontology,
      justifications // Pass the new justification as context
    )
    if (cascadeJustifications.length > 0) {
      await activities.storeJustifications(
        { orgId: input.orgId, repoId: input.repoId },
        cascadeJustifications
      )
      await activities.embedJustifications(
        { orgId: input.orgId, repoId: input.repoId },
        cascadeJustifications
      )
      cascadeCount = cascadeJustifications.length
    }
  }

  // Step 7: Update feature aggregations with all affected justifications
  const allJustifications = [...justifications]
  await activities.storeFeatureAggregations(
    { orgId: input.orgId, repoId: input.repoId },
    allJustifications
  )

  return { justified: true, cascadeCount }
}
