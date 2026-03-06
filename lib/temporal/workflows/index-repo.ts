import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow"
import { detectPatternsWorkflow } from "./detect-patterns"
import { embedRepoWorkflow } from "./embed-repo"
import { syncLocalGraphWorkflow } from "./sync-local-graph"
import type * as graphAnalysis from "../activities/graph-analysis"
import type * as heavy from "../activities/indexing-heavy"
import type * as light from "../activities/indexing-light"
import type * as pipelineLogs from "../activities/pipeline-logs"
import type * as pipelineRun from "../activities/pipeline-run"
import type * as temporalAnalysis from "../activities/temporal-analysis"
import type * as workspaceCleanup from "../activities/workspace-cleanup"

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
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 2 },
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

const temporalAnalysisActivities = proxyActivities<typeof temporalAnalysis>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "15m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 2 },
})

const cleanupActivities = proxyActivities<typeof workspaceCleanup>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 1 },
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

/** Format milliseconds into a human-readable duration string. */
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
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

  const pipelineStart = Date.now()
  try {
    const stepDurations: Record<string, number> = {}
    let t0 = Date.now()

    // Step 1: Clone repo, detect languages, detect monorepo roots
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "clone", status: "running" })
    wfLog("INFO", "Step 1/7: Preparing repo intelligence space (clone + scan)", ctx, "Step 1/7")
    const workspace = await heavyActivities.prepareRepoIntelligenceSpace({
      orgId: input.orgId,
      repoId: input.repoId,
      runId: input.runId,
      installationId: input.installationId,
      cloneUrl: input.cloneUrl,
      defaultBranch: input.defaultBranch,
    })
    progress = 25
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "clone", status: "completed" })
    stepDurations.clone = Date.now() - t0
    wfLog("INFO", `Step 1 complete: repo intelligence space ready (${formatMs(stepDurations.clone)})`, { ...ctx, languages: workspace.languages, lastSha: workspace.lastSha, durationMs: stepDurations.clone }, "Step 1/7")

    // Step 1b: Wipe existing graph data so reindex is a clean replace
    t0 = Date.now()
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "wipe", status: "running" })
    wfLog("INFO", "Step 1b: Wiping existing graph data", ctx, "Step 1b")
    await lightActivities.wipeRepoGraphData({ orgId: input.orgId, repoId: input.repoId })
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "wipe", status: "completed" })
    stepDurations.wipe = Date.now() - t0
    wfLog("INFO", `Step 1b complete: graph data cleared (${formatMs(stepDurations.wipe)})`, { ...ctx, durationMs: stepDurations.wipe }, "Step 1b")

    // Step 2: Run SCIP indexers (writes entities/edges directly to ArangoDB)
    t0 = Date.now()
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "scip", status: "running" })
    wfLog("INFO", "Step 2/7: Running SCIP indexers", ctx, "Step 2/7")
    const scip = await heavyActivities.runSCIP({
      indexDir: workspace.indexDir,
      orgId: input.orgId,
      repoId: input.repoId,
      runId: input.runId,
      languages: workspace.languages,
      packageRoots: workspace.packageRoots,
      indexVersion: input.indexVersion,
    })
    progress = 50
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "scip", status: "completed" })
    stepDurations.scip = Date.now() - t0
    wfLog("INFO", `Step 2 complete: SCIP done (${formatMs(stepDurations.scip)})`, { ...ctx, entities: scip.entityCount, edges: scip.edgeCount, coveredFiles: scip.coveredFiles.length, durationMs: stepDurations.scip }, "Step 2/7")

    // Step 3: Parse remaining files (writes entities/edges directly to ArangoDB)
    t0 = Date.now()
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "parse", status: "running" })
    wfLog("INFO", "Step 3/7: Parsing remaining files", ctx, "Step 3/7")
    const parse = await heavyActivities.parseRest({
      indexDir: workspace.indexDir,
      orgId: input.orgId,
      repoId: input.repoId,
      runId: input.runId,
      coveredFiles: scip.coveredFiles,
      indexVersion: input.indexVersion,
    })
    progress = 75
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "parse", status: "completed" })
    stepDurations.parse = Date.now() - t0
    wfLog("INFO", `Step 3 complete: parsing done (${formatMs(stepDurations.parse)})`, { ...ctx, extraEntities: parse.entityCount, extraEdges: parse.edgeCount, durationMs: stepDurations.parse }, "Step 3/7")

    // Aggregate per-kind counts from both steps (entities already in ArangoDB)
    const fileCount = scip.fileCount + parse.fileCount
    const functionCount = scip.functionCount + parse.functionCount
    const classCount = scip.classCount + parse.classCount
    const totalEntities = scip.entityCount + parse.entityCount
    const totalEdges = scip.edgeCount + parse.edgeCount

    wfLog("INFO", `Entity/edge totals: ${totalEntities} entities (SCIP: ${scip.entityCount}, tree-sitter: ${parse.entityCount}), ${totalEdges} edges (SCIP: ${scip.edgeCount}, tree-sitter: ${parse.edgeCount}) | ${fileCount} files, ${functionCount} functions, ${classCount} classes`, {
      ...ctx,
      totalEntities, totalEdges, fileCount, functionCount, classCount,
      scipEntities: scip.entityCount, treeSitterEntities: parse.entityCount,
      scipEdges: scip.edgeCount, treeSitterEdges: parse.edgeCount,
      scipCoveredFiles: scip.coveredFiles.length,
    }, "Step 3/7")

    // Step 4: Finalize indexing (shadow cleanup + status update — no entity data)
    t0 = Date.now()
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "finalize", status: "running" })
    wfLog("INFO", "Step 4/7: Finalizing index", ctx, "Step 4/7")
    await lightActivities.finalizeIndexing({
      orgId: input.orgId,
      repoId: input.repoId,
      runId: input.runId,
      fileCount,
      functionCount,
      classCount,
      indexVersion: input.indexVersion,
    })
    progress = 95
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "finalize", status: "completed" })
    stepDurations.finalize = Date.now() - t0
    wfLog("INFO", `Step 4 complete: finalized (${formatMs(stepDurations.finalize)})`, { ...ctx, durationMs: stepDurations.finalize }, "Step 4/7")
    const result = { entitiesWritten: totalEntities, edgesWritten: totalEdges, fileCount, functionCount, classCount }

    // Step 4b: Pre-compute blast radius (fan-in/fan-out for god function detection)
    t0 = Date.now()
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "blastRadius", status: "running" })
    wfLog("INFO", "Step 4b: Pre-computing blast radius", ctx, "Step 4b")
    const blastRadius = await graphAnalysisActivities.precomputeBlastRadius({
      orgId: input.orgId,
      repoId: input.repoId,
      runId: input.runId,
    })
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "blastRadius", status: "completed", meta: { updatedCount: blastRadius.updatedCount, highRiskCount: blastRadius.highRiskCount } })
    stepDurations.blastRadius = Date.now() - t0
    wfLog("INFO", `Step 4b complete: blast radius computed (${formatMs(stepDurations.blastRadius)})`, { ...ctx, updated: blastRadius.updatedCount, highRisk: blastRadius.highRiskCount, durationMs: stepDurations.blastRadius }, "Step 4b")

    // Step 4c: L-24 temporal analysis (git co-change mining)
    t0 = Date.now()
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "temporalAnalysis", status: "running" })
    wfLog("INFO", "Step 4c: Mining temporal intent vectors", ctx, "Step 4c")
    const temporal = await temporalAnalysisActivities.computeTemporalAnalysis({
      orgId: input.orgId,
      repoId: input.repoId,
      runId: input.runId,
      workspacePath: workspace.indexDir,
    })
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "temporalAnalysis", status: "completed", meta: { coChangeEdges: temporal.coChangeEdgesStored, entitiesUpdated: temporal.entitiesUpdated } })
    stepDurations.temporalAnalysis = Date.now() - t0
    wfLog("INFO", `Step 4c complete: temporal analysis done (${formatMs(stepDurations.temporalAnalysis)})`, { ...ctx, coChangeEdges: temporal.coChangeEdgesStored, entitiesUpdated: temporal.entitiesUpdated, filesAnalyzed: temporal.filesAnalyzed, durationMs: stepDurations.temporalAnalysis }, "Step 4c")

    // Child workflow IDs use stable orgId+repoId (no runId suffix).
    // Previously we used wfInfo.runId.slice(0,8) as suffix, which changes
    // on every Temporal retry, spawning duplicate child workflows that
    // process the same batches in parallel. With stable IDs, Temporal
    // rejects the duplicate if one is already running.

    // Step 5: Fire-and-forget the embedding workflow (Phase 3)
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "embed", status: "running" })
    wfLog("INFO", "Step 5/7: Starting embed workflow", ctx, "Step 5/7")
    try {
      await startChild(embedRepoWorkflow, {
        workflowId: `embed-${input.orgId}-${input.repoId}`,
        taskQueue: "light-llm-queue",
        args: [{ orgId: input.orgId, repoId: input.repoId, lastIndexedSha: workspace.lastSha, runId: input.runId }],
        parentClosePolicy: ParentClosePolicy.ABANDON,
      })
    } catch (childErr: unknown) {
      // If workflow already exists (from a previous attempt), that's fine — it's
      // already processing the same data. Log and continue.
      const msg = childErr instanceof Error ? childErr.message : String(childErr)
      if (msg.includes("already started") || msg.includes("already exists")) {
        wfLog("WARN", "Embed workflow already running, skipping duplicate", { ...ctx, existingWorkflowId: `embed-${input.orgId}-${input.repoId}` }, "Step 5/7")
      } else {
        throw childErr
      }
    }

    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "embed", status: "completed" })

    // Step 6: Fire-and-forget the local graph sync workflow (Phase 10a)
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "graphSync", status: "running" })
    wfLog("INFO", "Step 6/7: Starting graph sync workflow", ctx, "Step 6/7")
    try {
      await startChild(syncLocalGraphWorkflow, {
        workflowId: `sync-${input.orgId}-${input.repoId}`,
        taskQueue: "light-llm-queue",
        args: [{ orgId: input.orgId, repoId: input.repoId }],
        parentClosePolicy: ParentClosePolicy.ABANDON,
      })
    } catch (childErr: unknown) {
      const msg = childErr instanceof Error ? childErr.message : String(childErr)
      if (msg.includes("already started") || msg.includes("already exists")) {
        wfLog("WARN", "Sync workflow already running, skipping duplicate", { ...ctx, existingWorkflowId: `sync-${input.orgId}-${input.repoId}` }, "Step 6/7")
      } else {
        throw childErr
      }
    }

    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "graphSync", status: "completed" })

    // Step 7: Fire-and-forget pattern detection workflow (Phase 6)
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "patternDetection", status: "running" })
    wfLog("INFO", "Step 7/7: Starting pattern detection workflow", ctx, "Step 7/7")
    try {
      await startChild(detectPatternsWorkflow, {
        workflowId: `detect-patterns-${input.orgId}-${input.repoId}`,
        taskQueue: "heavy-compute-queue",
        args: [{
          orgId: input.orgId,
          repoId: input.repoId,
          runId: input.runId,
          workspacePath: workspace.indexDir,
          languages: workspace.languages,
        }],
        parentClosePolicy: ParentClosePolicy.ABANDON,
      })
    } catch (childErr: unknown) {
      const msg = childErr instanceof Error ? childErr.message : String(childErr)
      if (msg.includes("already started") || msg.includes("already exists")) {
        wfLog("WARN", "Pattern detection workflow already running, skipping duplicate", { ...ctx, existingWorkflowId: `detect-patterns-${input.orgId}-${input.repoId}` }, "Step 7/7")
      } else {
        throw childErr
      }
    }

    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "patternDetection", status: "completed" })

    // K-01: Best-effort workspace cleanup. Pattern detection will also clean up
    // after it finishes. This is a fallback in case pattern detection fails before cleanup.
    // Uses fire-and-forget so it doesn't block the main workflow completion.
    cleanupActivities.cleanupWorkspaceFilesystem({ orgId: input.orgId, repoId: input.repoId }).catch(() => {})

    progress = 100
    const totalDurationMs = Date.now() - pipelineStart

    // Signal quality: ratio of high-fidelity SCIP coverage vs tree-sitter fallback.
    // fileCount (scip.fileCount + parse.fileCount) is the authoritative total since
    // parseRest creates file entities for every scanned file and the graph deduplicates.
    const totalFilesDiscovered = fileCount
    const scipCoveragePercent = totalFilesDiscovered > 0
      ? Math.min(100, Math.round((scip.coveredFiles.length / totalFilesDiscovered) * 100))
      : 0
    const treeSitterOnlyPercent = 100 - scipCoveragePercent

    const completionSummary = {
      fileCount,
      functionCount,
      classCount,
      entitiesWritten: result.entitiesWritten,
      edgesWritten: result.edgesWritten,
      scipCoveragePercent,
      treeSitterOnlyPercent,
      highRiskNodes: blastRadius.highRiskCount,
      coChangeEdges: temporal.coChangeEdgesStored,
      totalDuration: formatMs(totalDurationMs),
      totalDurationMs,
      stepDurations,
      repoId: input.repoId,
      ...(input.runId && { runId: input.runId }),
    }

    // Await final log calls so they complete before the workflow finishes.
    // Fire-and-forget causes "Activity not found on completion" warnings
    // because the workflow ends before the activity can report back.
    await logActivities.appendPipelineLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "indexing",
      step: "Complete",
      message: `Indexing complete — ${fileCount} files, ${functionCount} functions, ${classCount} classes | Quality: ${scipCoveragePercent}% SCIP, ${treeSitterOnlyPercent}% tree-sitter | ${formatMs(totalDurationMs)}`,
      meta: completionSummary,
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

    wfLog("INFO", `Indexing complete — ${fileCount} files, ${functionCount} functions, ${classCount} classes | Quality: ${scipCoveragePercent}% SCIP, ${treeSitterOnlyPercent}% tree-sitter | ${formatMs(totalDurationMs)}`, { ...ctx, ...completionSummary }, "Complete")
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const elapsedMs = Date.now() - pipelineStart
    wfLog("ERROR", `Indexing workflow failed after ${formatMs(elapsedMs)}`, { ...ctx, errorMessage: message, elapsedMs }, "Error")

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
