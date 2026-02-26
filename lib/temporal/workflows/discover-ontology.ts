/**
 * Phase 4: discoverOntologyWorkflow — extracts domain ontology then chains
 * to justifyRepoWorkflow.
 *
 * Workflow ID: ontology-{orgId}-{repoId}
 * Queue: light-llm-queue
 */

import { ParentClosePolicy, proxyActivities, startChild, workflowInfo } from "@temporalio/workflow"
import { justifyRepoWorkflow } from "./justify-repo"
import type * as ontologyActivities from "../activities/ontology"
import type * as pipelineLogs from "../activities/pipeline-logs"

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

  // Step 1: Discover, refine, and store ontology (all in one activity — no large payloads)
  wfLog("INFO", "Step 1/2: Discovering and storing ontology", ctx, "Step 1/2")
  const { termCount } = await activities.discoverAndStoreOntology({
    orgId: input.orgId,
    repoId: input.repoId,
  })
  wfLog("INFO", "Step 1 complete: ontology stored", { ...ctx, termCount }, "Step 1/2")

  // Step 2: Chain to justification workflow
  wfLog("INFO", "Step 2/2: Starting justification workflow", ctx, "Step 2/2")
  await startChild(justifyRepoWorkflow, {
    workflowId: `justify-${input.orgId}-${input.repoId}-${workflowInfo().runId.slice(0, 8)}`,
    taskQueue: "light-llm-queue",
    args: [{ orgId: input.orgId, repoId: input.repoId }],
    parentClosePolicy: ParentClosePolicy.ABANDON,
  })

  await logActivities.appendPipelineLog({
    timestamp: new Date().toISOString(),
    level: "info",
    phase: "ontology",
    step: "Complete",
    message: "Ontology discovery workflow complete",
    meta: { repoId: input.repoId },
  })
  await logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId })
  console.log(`[${new Date().toISOString()}] [INFO ] [wf:discover-ontology] [${input.orgId}/${input.repoId}] Ontology discovery workflow complete`)
}
