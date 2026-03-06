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
import type * as pipelineRun from "../activities/pipeline-run"

const activities = proxyActivities<typeof ontologyActivities>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

const logActivities = proxyActivities<typeof pipelineLogs>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 2 },
})

const runActivities = proxyActivities<typeof pipelineRun>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 2 },
})

export interface DiscoverOntologyInput {
  orgId: string
  repoId: string
  runId?: string
}

/** Workflow-safe log helper */
function wfLog(level: string, msg: string, ctx: Record<string, unknown>, step?: string) {
  const ts = new Date().toISOString()
  const orgId = ctx.organizationId ?? "-"
  const repoId = ctx.repoId ?? "-"
  const runId = ctx.runId as string | undefined
  const extra = { ...ctx }
  delete extra.organizationId
  delete extra.repoId
  delete extra.runId
  const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : ""
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:discover-ontology] [${orgId}/${repoId}] ${msg}${extraStr}`)

  logActivities
    .appendPipelineLog({
      timestamp: ts,
      level: level.toLowerCase() as "info" | "warn" | "error",
      phase: "ontology",
      step: step ?? "",
      message: msg,
      meta: { ...extra, repoId: String(repoId), ...(runId && { runId }) },
    })
    .catch(() => {})
}

export async function discoverOntologyWorkflow(input: DiscoverOntologyInput): Promise<void> {
  const ctx = { organizationId: input.orgId, repoId: input.repoId, runId: input.runId }
  const workflowStart = Date.now()
  wfLog("INFO", "━━━ ONTOLOGY DISCOVERY STARTED ━━━", ctx, "Start")

  if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "ontology", status: "running" })

  // Step 1: Discover, refine, and store ontology (all in one activity — no large payloads)
  const step1Start = Date.now()
  wfLog("INFO", "Step 1/2: Discovering and storing ontology", ctx, "Step 1/2")
  const { termCount } = await activities.discoverAndStoreOntology({
    orgId: input.orgId,
    repoId: input.repoId,
    runId: input.runId,
  })
  const step1Ms = Date.now() - step1Start
  wfLog("INFO", `Step 1 complete: ontology stored — ${termCount} terms (${step1Ms}ms)`, { ...ctx, termCount, durationMs: step1Ms }, "Step 1/2")

  // TBI-F-01: Mark ontology step complete with metrics
  if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "ontology", status: "completed", meta: { termCount } })

  // Step 2: Chain to justification workflow
  wfLog("INFO", "Step 2/2: Starting justification workflow", ctx, "Step 2/2")
  await startChild(justifyRepoWorkflow, {
    workflowId: `justify-${input.orgId}-${input.repoId}-${workflowInfo().runId.slice(0, 8)}`,
    taskQueue: "light-llm-queue",
    args: [{ orgId: input.orgId, repoId: input.repoId, runId: input.runId }],
    parentClosePolicy: ParentClosePolicy.ABANDON,
  })

  const totalMs = Date.now() - workflowStart
  const summary = `━━━ ONTOLOGY COMPLETE ━━━ ${termCount} terms discovered in ${Math.round(totalMs / 1000)}s`
  await logActivities.appendPipelineLog({
    timestamp: new Date().toISOString(),
    level: "info",
    phase: "ontology",
    step: "Complete",
    message: summary,
    meta: { repoId: input.repoId, termCount, totalMs, ...(input.runId && { runId: input.runId }) },
  })
  await logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId })
  console.log(`[${new Date().toISOString()}] [INFO ] [wf:discover-ontology] [${input.orgId}/${input.repoId}] ${summary}`)
}
