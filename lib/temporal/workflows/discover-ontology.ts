/**
 * Phase 4: discoverOntologyWorkflow — extracts domain ontology then chains
 * to justifyRepoWorkflow.
 *
 * Workflow ID: ontology-{orgId}-{repoId}
 * Queue: light-llm-queue
 */

import { ParentClosePolicy, proxyActivities, startChild } from "@temporalio/workflow"
import type * as ontologyActivities from "../activities/ontology"
import { justifyRepoWorkflow } from "./justify-repo"

const activities = proxyActivities<typeof ontologyActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

export interface DiscoverOntologyInput {
  orgId: string
  repoId: string
}

export async function discoverOntologyWorkflow(input: DiscoverOntologyInput): Promise<void> {
  // Step 1: Fetch entities
  const entities = await activities.fetchEntitiesForOntology({
    orgId: input.orgId,
    repoId: input.repoId,
  })

  // Step 2: Extract and refine ontology
  const ontology = await activities.extractAndRefineOntology(
    { orgId: input.orgId, repoId: input.repoId },
    entities
  )

  // Step 3: Store ontology
  await activities.storeOntology(
    { orgId: input.orgId, repoId: input.repoId },
    ontology
  )

  // Step 4: Chain to justification workflow
  await startChild(justifyRepoWorkflow, {
    workflowId: `justify-${input.orgId}-${input.repoId}`,
    taskQueue: "light-llm-queue",
    args: [{ orgId: input.orgId, repoId: input.repoId }],
    parentClosePolicy: ParentClosePolicy.ABANDON,
  })
}
