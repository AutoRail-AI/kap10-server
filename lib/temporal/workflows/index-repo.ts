import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow"
import { detectPatternsWorkflow } from "./detect-patterns"
import { embedRepoWorkflow } from "./embed-repo"
import { syncLocalGraphWorkflow } from "./sync-local-graph"
import type * as graphAnalysis from "../activities/graph-analysis"
import type * as heavy from "../activities/indexing-heavy"
import type * as light from "../activities/indexing-light"
import type * as pipelineLogs from "../activities/pipeline-logs"
import type * as pipelineRun from "../activities/pipeline-run"

const heavyActivities = proxyActivities<typeof heavy>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "30m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 3 },
})

const lightActivities = proxyActivities<typeof light>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  heartbeatTimeout: "1m",
  retry: { maximumAttempts: 3 },
})

const logActivities = proxyActivities<typeof pipelineLogs>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 1 },
})

const runActivities = proxyActivities<typeof pipelineRun>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 2 },
})

const graphAnalysisActivities = proxyActivities<typeof graphAnalysis>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "10m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 2 },
})

export const getProgressQuery = defineQuery<number>("getProgress")

export interface IndexRepoInput {
  orgId: string
  repoId: string
  installationId: number
  cloneUrl: string
  defaultBranch: string
  indexVersion?: string
  runId?: string
}

/** Workflow-safe log helper (Temporal sandbox — no require/import of Node modules) */
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
  console.log(`[${ts}] [${level.padEnd(5)}] [wf:index-repo] [${orgId}/${repoId}] ${msg}${extraStr}`)

  // Fire-and-forget pipeline log to Redis
  logActivities
    .appendPipelineLog({
      timestamp: ts,
      level: level.toLowerCase() as "info" | "warn" | "error",
      phase: "indexing",
      step: step ?? "",
      message: msg,
      meta: { ...extra, repoId: String(repoId), ...(runId && { runId }) },
    })
    .catch(() => {})
}

export async function indexRepoWorkflow(input: IndexRepoInput): Promise<{
  entitiesWritten: number
  edgesWritten: number
  fileCount: number
  functionCount: number
  classCount: number
}> {
  const ctx = { organizationId: input.orgId, repoId: input.repoId, runId: input.runId }
  let progress = 0
  setHandler(getProgressQuery, () => progress)

  // Initialize pipeline run tracking if runId is present
  const wfInfo = workflowInfo()
  if (input.runId) {
    await runActivities.initPipelineRun({
      runId: input.runId,
      orgId: input.orgId,
      repoId: input.repoId,
      workflowId: wfInfo.workflowId,
      temporalRunId: wfInfo.runId,
      triggerType: "initial",
      pipelineType: "full",
      indexVersion: input.indexVersion,
    })
  }

  wfLog("INFO", "Indexing workflow started", { ...ctx, cloneUrl: input.cloneUrl, defaultBranch: input.defaultBranch }, "Start")

  try {
    // Step 1: Clone repo, detect languages, detect monorepo roots
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "clone", status: "running" })
    wfLog("INFO", "Step 1/7: Preparing repo intelligence space (clone + scan)", ctx, "Step 1/7")
    const workspace = await heavyActivities.prepareRepoIntelligenceSpace({
      orgId: input.orgId,
      repoId: input.repoId,
      installationId: input.installationId,
      cloneUrl: input.cloneUrl,
      defaultBranch: input.defaultBranch,
    })
    progress = 25
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "clone", status: "completed" })
    wfLog("INFO", "Step 1 complete: repo intelligence space ready", { ...ctx, languages: workspace.languages, lastSha: workspace.lastSha }, "Step 1/7")

    // Step 1b: Wipe existing graph data so reindex is a clean replace
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "wipe", status: "running" })
    wfLog("INFO", "Step 1b: Wiping existing graph data", ctx, "Step 1b")
    await lightActivities.wipeRepoGraphData({ orgId: input.orgId, repoId: input.repoId })
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "wipe", status: "completed" })
    wfLog("INFO", "Step 1b complete: graph data cleared", ctx, "Step 1b")

    // Step 2: Run SCIP indexers (writes entities/edges directly to ArangoDB)
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "scip", status: "running" })
    wfLog("INFO", "Step 2/7: Running SCIP indexers", ctx, "Step 2/7")
    const scip = await heavyActivities.runSCIP({
      workspacePath: workspace.workspacePath,
      orgId: input.orgId,
      repoId: input.repoId,
      languages: workspace.languages,
      workspaceRoots: workspace.workspaceRoots,
      indexVersion: input.indexVersion,
    })
    progress = 50
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "scip", status: "completed" })
    wfLog("INFO", "Step 2 complete: SCIP done", { ...ctx, entities: scip.entityCount, edges: scip.edgeCount, coveredFiles: scip.coveredFiles.length }, "Step 2/7")

    // Step 3: Parse remaining files (writes entities/edges directly to ArangoDB)
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "parse", status: "running" })
    wfLog("INFO", "Step 3/7: Parsing remaining files", ctx, "Step 3/7")
    const parse = await heavyActivities.parseRest({
      workspacePath: workspace.workspacePath,
      orgId: input.orgId,
      repoId: input.repoId,
      coveredFiles: scip.coveredFiles,
      indexVersion: input.indexVersion,
    })
    progress = 75
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "parse", status: "completed" })
    wfLog("INFO", "Step 3 complete: parsing done", { ...ctx, extraEntities: parse.entityCount, extraEdges: parse.edgeCount }, "Step 3/7")

    // Aggregate per-kind counts from both steps (entities already in ArangoDB)
    const fileCount = scip.fileCount + parse.fileCount
    const functionCount = scip.functionCount + parse.functionCount
    const classCount = scip.classCount + parse.classCount

    // Step 4: Finalize indexing (shadow cleanup + status update — no entity data)
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "finalize", status: "running" })
    wfLog("INFO", "Step 4/7: Finalizing index", ctx, "Step 4/7")
    await lightActivities.finalizeIndexing({
      orgId: input.orgId,
      repoId: input.repoId,
      fileCount,
      functionCount,
      classCount,
      indexVersion: input.indexVersion,
    })
    progress = 95
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "finalize", status: "completed" })
    const result = { entitiesWritten: scip.entityCount + parse.entityCount, edgesWritten: scip.edgeCount + parse.edgeCount, fileCount, functionCount, classCount }

    // Step 4b: Pre-compute blast radius (fan-in/fan-out for god function detection)
    wfLog("INFO", "Step 4b: Pre-computing blast radius", ctx, "Step 4b")
    const blastRadius = await graphAnalysisActivities.precomputeBlastRadius({
      orgId: input.orgId,
      repoId: input.repoId,
    })
    wfLog("INFO", "Step 4b complete: blast radius computed", { ...ctx, updated: blastRadius.updatedCount, highRisk: blastRadius.highRiskCount }, "Step 4b")

    // Derive unique child workflow IDs from the parent run ID so re-indexing
    // never collides with previous runs
    const suffix = wfInfo.runId.slice(0, 8)

    // Step 5: Fire-and-forget the embedding workflow (Phase 3)
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "embed", status: "running" })
    wfLog("INFO", "Step 5/7: Starting embed workflow", ctx, "Step 5/7")
    await startChild(embedRepoWorkflow, {
      workflowId: `embed-${input.orgId}-${input.repoId}-${suffix}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId, lastIndexedSha: workspace.lastSha, runId: input.runId }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })

    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "embed", status: "completed" })

    // Step 6: Fire-and-forget the local graph sync workflow (Phase 10a)
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "graphSync", status: "running" })
    wfLog("INFO", "Step 6/7: Starting graph sync workflow", ctx, "Step 6/7")
    await startChild(syncLocalGraphWorkflow, {
      workflowId: `sync-${input.orgId}-${input.repoId}-${suffix}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })

    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "graphSync", status: "completed" })

    // Step 7: Fire-and-forget pattern detection workflow (Phase 6)
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "patternDetection", status: "running" })
    wfLog("INFO", "Step 7/7: Starting pattern detection workflow", ctx, "Step 7/7")
    await startChild(detectPatternsWorkflow, {
      workflowId: `detect-patterns-${input.orgId}-${input.repoId}-${suffix}`,
      taskQueue: "heavy-compute-queue",
      args: [{
        orgId: input.orgId,
        repoId: input.repoId,
        workspacePath: workspace.workspacePath,
        languages: workspace.languages,
      }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })

    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "patternDetection", status: "completed" })

    progress = 100
    // Await final log calls so they complete before the workflow finishes.
    // Fire-and-forget causes "Activity not found on completion" warnings
    // because the workflow ends before the activity can report back.
    await logActivities.appendPipelineLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "indexing",
      step: "Complete",
      message: "Indexing workflow complete",
      meta: { fileCount, functionCount, classCount, repoId: input.repoId, ...(input.runId && { runId: input.runId }) },
    })
    await logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId })

    // Complete pipeline run tracking
    if (input.runId) {
      await runActivities.completePipelineRun({
        runId: input.runId,
        status: "completed",
        fileCount,
        functionCount,
        classCount,
        entitiesWritten: result.entitiesWritten,
        edgesWritten: result.edgesWritten,
      })
    }

    console.log(`[${new Date().toISOString()}] [INFO ] [wf:index-repo] [${input.orgId}/${input.repoId}] Indexing workflow complete ${JSON.stringify({ fileCount, functionCount, classCount })}`)
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    wfLog("ERROR", "Indexing workflow failed", { ...ctx, errorMessage: message }, "Error")

    // Mark current step as failed + complete the run as failed
    if (input.runId) {
      await runActivities.completePipelineRun({
        runId: input.runId,
        status: "failed",
        errorMessage: message,
      })
    }

    // Best-effort archive on failure — don't block the error throw
    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId }).catch(() => {})
    await lightActivities.updateRepoError(input.repoId, message)
    throw err
  }
}
