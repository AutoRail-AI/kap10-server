/**
 * Phase 4: discoverOntologyWorkflow — extracts domain ontology then chains
 * to justifyRepoWorkflow.
 *
 * Workflow ID: ontology-{orgId}-{repoId}
 * Queue: light-llm-queue
 */

import { ParentClosePolicy, proxyActivities, startChild, workflowInfo } from "@temporalio/workflow"
import type * as ontologyActivities from "../activities/ontology"
import type * as pipelineLogs from "../activities/pipeline-logs"
import { justifyRepoWorkflow } from "./justify-repo"

const activities = proxyActivities<typeof ontologyActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

const logActivities = proxyActivities<typeof pipelineLogs>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 1 },
})

export interface DiscoverOntologyInput {
  orgId: string
  repoId: string
}

/** Workflow-safe log helper */
function wfLog(level: string, msg: string, ctx: Record<string, unknown>, step?: string) {
  const ts = new Date().toISOString()
  const orgId = ctx.organizationId ?? "-"
  const repoId = ctx.repoId ?? "-"
  const extra = { ...ctx }
  delete extra.organizationId
  delete extra.repoId
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : ""
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:discover-ontology] [${orgId}/${repoId}] ${msg}${extraStr}`)

  logActivities
    .appendPipelineLog({
      timestamp: ts,
      level: level.toLowerCase() as "info" | "warn" | "error",
      phase: "ontology",
      step: step ?? "",
      message: msg,
      meta: { ...extra, repoId: String(repoId) },
    })
    .catch(() => {})
}

export async function discoverOntologyWorkflow(input: DiscoverOntologyInput): Promise<void> {
  const ctx = { organizationId: input.orgId, repoId: input.repoId }
  wfLog("INFO", "Ontology discovery workflow started", ctx, "Start")

  // Step 1: Fetch entities
  wfLog("INFO", "Step 1/4: Fetching entities", ctx, "Step 1/4")
  const entities = await activities.fetchEntitiesForOntology({
    orgId: input.orgId,
    repoId: input.repoId,
  })
  wfLog("INFO", "Step 1 complete: entities fetched", { ...ctx, entityCount: entities.length }, "Step 1/4")

  // Step 2: Extract and refine ontology
  wfLog("INFO", "Step 2/4: Extracting and refining ontology", ctx, "Step 2/4")
  const ontology = await activities.extractAndRefineOntology(
    { orgId: input.orgId, repoId: input.repoId },
    entities
  )
  wfLog("INFO", "Step 2 complete: ontology refined", { ...ctx, termCount: ontology.terms.length }, "Step 2/4")

  // Step 3: Store ontology
  wfLog("INFO", "Step 3/4: Storing ontology", ctx, "Step 3/4")
  await activities.storeOntology(
    { orgId: input.orgId, repoId: input.repoId },
    ontology
  )

  // Step 4: Chain to justification workflow
  wfLog("INFO", "Step 4/4: Starting justification workflow", ctx, "Step 4/4")
  await startChild(justifyRepoWorkflow, {
    workflowId: `justify-${input.orgId}-${input.repoId}-${workflowInfo().runId.slice(0, 8)}`,
    taskQueue: "light-llm-queue",
    args: [{ orgId: input.orgId, repoId: input.repoId }],
    parentClosePolicy: ParentClosePolicy.ABANDON,
  })

  wfLog("INFO", "Ontology discovery workflow complete", ctx, "Complete")
  logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId }).catch(() => {})
}
