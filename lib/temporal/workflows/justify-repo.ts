/**
 * Phase 4: justifyRepoWorkflow — orchestrates the full justification pipeline.
 *
 * Workflow ID: justify-{orgId}-{repoId}
 * Queue: light-llm-queue
 *
 * Steps:
 *   1. Set repo status to "justifying"
 *   2. Fetch all entities + edges
 *   3. Load domain ontology
 *   4. Topological sort (bottom-up ordering)
 *   5. For each level: build graph contexts → apply heuristics → LLM → store
 *   6. Post-process: normalize + deduplicate features
 *   7. Embed justifications in pgvector
 *   8. Chain to health report generation
 *   9. Set repo status to "ready"
 */

import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild } from "@temporalio/workflow"
import type * as justificationActivities from "../activities/justification"
import { generateHealthReportWorkflow } from "./generate-health-report"
import type { JustificationDoc } from "@/lib/ports/types"

const activities = proxyActivities<typeof justificationActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "60m",
  heartbeatTimeout: "5m",
  retry: { maximumAttempts: 3 },
})

export const getJustifyProgressQuery = defineQuery<number>("getJustifyProgress")

export interface JustifyRepoInput {
  orgId: string
  repoId: string
}

export async function justifyRepoWorkflow(input: JustifyRepoInput): Promise<{
  entitiesJustified: number
  embeddingsStored: number
}> {
  let progress = 0
  setHandler(getJustifyProgressQuery, () => progress)

  try {
    // Step 1: Set status
    await activities.setJustifyingStatus(input)
    progress = 5

    // Step 2: Fetch entities and edges
    const { entities, edges } = await activities.fetchEntitiesAndEdges(input)
    progress = 15

    if (entities.length === 0) {
      await activities.setJustifyDoneStatus(input)
      return { entitiesJustified: 0, embeddingsStored: 0 }
    }

    // Step 3: Load ontology
    const ontology = await activities.loadOntology(input)
    progress = 20

    // Step 4: Topological sort
    const levels = await activities.performTopologicalSort(entities, edges)
    progress = 25

    // Step 5: Process each level bottom-up
    const allJustifications: JustificationDoc[] = []
    const levelProgressStep = 50 / Math.max(levels.length, 1)

    for (let i = 0; i < levels.length; i++) {
      const levelEntities = levels[i]!
      const levelJustifications = await activities.justifyBatch(
        input,
        levelEntities,
        edges,
        ontology,
        allJustifications // Previous levels' justifications propagate up
      )

      // Store this level's justifications
      await activities.storeJustifications(input, levelJustifications)
      allJustifications.push(...levelJustifications)
      progress = Math.round(25 + (i + 1) * levelProgressStep)
    }

    // Step 6: Store feature aggregations
    await activities.storeFeatureAggregations(input, allJustifications)
    progress = 80

    // Step 7: Embed justifications
    const embeddingsStored = await activities.embedJustifications(input, allJustifications)
    progress = 90

    // Step 8: Chain to health report
    await startChild(generateHealthReportWorkflow, {
      workflowId: `health-${input.orgId}-${input.repoId}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })

    // Step 9: Set ready
    await activities.setJustifyDoneStatus(input)
    progress = 100

    return {
      entitiesJustified: allJustifications.length,
      embeddingsStored,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await activities.setJustifyFailedStatus(input.repoId, message)
    throw err
  }
}
