import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow"
import { detectPatternsWorkflow } from "./detect-patterns"
import { embedRepoWorkflow } from "./embed-repo"
import { syncLocalGraphWorkflow } from "./sync-local-graph"
import type * as graphAnalysis from "../activities/graph-analysis"
import type * as heavy from "../activities/indexing-heavy"
import type * as ingestSourceMod from "../activities/ingest-source"
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

// Phase 13: ingestSource runs on light queue (network-bound, not CPU-bound)
const ingestActivities = proxyActivities<typeof ingestSourceMod>({
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

/**
 * Phase 13 input — provider-based, not clone-URL-based.
 * The workflow calls ingestSource to normalize into a SourceSpec, then
 * uses worktrees for all SCIP/tree-sitter operations.
 */
export interface IndexRepoInput {
  orgId: string
  repoId: string
  provider: "github" | "local_cli"
  /** GitHub repos: installation ID for GitHub App auth */
  installationId?: number
  /** GitHub repos: HTTPS clone URL */
  cloneUrl?: string
  defaultBranch: string
  /** Local CLI repos: Supabase Storage path (legacy zip upload, pre-Phase 13) */
  uploadPath?: string
  /** Shadow reindex version tag */
  indexVersion?: string
  /** Pipeline run tracking ID */
  runId?: string
  /** Phase 13: Entity scope (default "primary") */
  scope?: string
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
  const scope = input.scope ?? "primary"
  let progress = 0
  setHandler(getProgressQuery, () => progress)

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

  wfLog("INFO", "Indexing workflow started", { ...ctx, provider: input.provider, defaultBranch: input.defaultBranch, scope }, "Start")

  const pipelineStart = Date.now()

  // Track worktree path so we can clean it up in finally{} if the activity created one
  let worktreePath: string | null = null
  let worktreeIsActive = false

  try {
    const stepDurations: Record<string, number> = {}
    let t0 = Date.now()

    // ── Step 0: Ingest source into bare Git object store ────────────────
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "clone", status: "running" })
    wfLog("INFO", "Step 0/7: Ingesting source into gitserver", ctx, "Step 0/7")

    let commitSha: string | undefined
    let ref: string | undefined

    try {
      const ingestResult = await ingestActivities.ingestSource({
        orgId: input.orgId,
        repoId: input.repoId,
        runId: input.runId,
        provider: input.provider,
        installationId: input.installationId,
        cloneUrl: input.cloneUrl,
        defaultBranch: input.defaultBranch,
      })
      commitSha = ingestResult.commitSha
      ref = ingestResult.ref
      wfLog("INFO", `Step 0 complete: source ingested — ${commitSha.slice(0, 8)}`, { ...ctx, commitSha, ref }, "Step 0/7")
    } catch (ingestErr: unknown) {
      // Gitea may not be available yet — fall through to legacy clone path
      const msg = ingestErr instanceof Error ? ingestErr.message : String(ingestErr)
      wfLog("WARN", `ingestSource failed, falling back to legacy clone: ${msg}`, ctx, "Step 0/7")
    }

    stepDurations.ingest = Date.now() - t0

    // ── Step 1: Create worktree (or legacy clone) and scan ──────────────
    t0 = Date.now()
    wfLog("INFO", "Step 1/7: Preparing repo intelligence space", ctx, "Step 1/7")
    const workspace = await heavyActivities.prepareRepoIntelligenceSpace({
      orgId: input.orgId,
      repoId: input.repoId,
      runId: input.runId,
      commitSha,
      ref,
      defaultBranch: input.defaultBranch,
      provider: input.provider,
      installationId: input.installationId,
      cloneUrl: input.cloneUrl,
      uploadPath: input.uploadPath,
    })

    // Track worktree for cleanup
    if (workspace.isWorktree) {
      worktreePath = workspace.indexDir
      worktreeIsActive = true
    }

    progress = 25
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "clone", status: "completed" })
    stepDurations.clone = Date.now() - t0
    wfLog("INFO", `Step 1 complete: repo intelligence space ready (${formatMs(stepDurations.clone)})`, { ...ctx, languages: workspace.languages, lastSha: workspace.lastSha, isWorktree: workspace.isWorktree, durationMs: stepDurations.clone }, "Step 1/7")

    // Use resolved commitSha from worktree if available
    const resolvedSha = workspace.lastSha ?? commitSha ?? null

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
      scope,
      commitSha: resolvedSha,
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
      scope,
      commitSha: resolvedSha,
    })
    progress = 75
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "parse", status: "completed" })
    stepDurations.parse = Date.now() - t0
    wfLog("INFO", `Step 3 complete: parsing done (${formatMs(stepDurations.parse)})`, { ...ctx, extraEntities: parse.entityCount, extraEdges: parse.edgeCount, durationMs: stepDurations.parse }, "Step 3/7")

    // Aggregate per-kind counts
    const fileCount = scip.fileCount + parse.fileCount
    const functionCount = scip.functionCount + parse.functionCount
    const classCount = scip.classCount + parse.classCount
    const totalEntities = scip.entityCount + parse.entityCount
    const totalEdges = scip.edgeCount + parse.edgeCount

    wfLog("INFO", `Entity/edge totals: ${totalEntities} entities, ${totalEdges} edges | ${fileCount} files, ${functionCount} functions, ${classCount} classes`, {
      ...ctx, totalEntities, totalEdges, fileCount, functionCount, classCount,
    }, "Step 3/7")

    // ── Phase 13: Remove worktree ASAP after SCIP/tree-sitter are done ──
    // Pattern detection (Step 7) also needs the workspace, so we keep it until
    // after temporal analysis. But the worktree GC cron is the safety net.
    // For now we leave cleanup to the finally{} block + workspace-cleanup activity.

    // Step 4: Finalize indexing
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

    // Step 4b: Pre-compute blast radius
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

    // Step 4c: Temporal analysis
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
    wfLog("INFO", `Step 4c complete: temporal analysis done (${formatMs(stepDurations.temporalAnalysis)})`, { ...ctx, coChangeEdges: temporal.coChangeEdgesStored, entitiesUpdated: temporal.entitiesUpdated, durationMs: stepDurations.temporalAnalysis }, "Step 4c")

    // Step 5: Fire-and-forget embed workflow
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
      const msg = childErr instanceof Error ? childErr.message : String(childErr)
      if (msg.includes("already started") || msg.includes("already exists")) {
        wfLog("WARN", "Embed workflow already running, skipping duplicate", ctx, "Step 5/7")
      } else {
        throw childErr
      }
    }
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "embed", status: "completed" })

    // Step 6: Fire-and-forget graph sync
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
        wfLog("WARN", "Sync workflow already running, skipping duplicate", ctx, "Step 6/7")
      } else {
        throw childErr
      }
    }
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "graphSync", status: "completed" })

    // Step 7: Fire-and-forget pattern detection
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
        wfLog("WARN", "Pattern detection workflow already running, skipping duplicate", ctx, "Step 7/7")
      } else {
        throw childErr
      }
    }
    if (input.runId) await runActivities.updatePipelineStep({ runId: input.runId, stepName: "patternDetection", status: "completed" })

    // Best-effort workspace cleanup (worktree or legacy clone dir)
    cleanupActivities.cleanupWorkspaceFilesystem({ orgId: input.orgId, repoId: input.repoId }).catch(() => {})

    progress = 100
    const totalDurationMs = Date.now() - pipelineStart

    const totalFilesDiscovered = fileCount
    const scipCoveragePercent = totalFilesDiscovered > 0
      ? Math.min(100, Math.round((scip.coveredFiles.length / totalFilesDiscovered) * 100))
      : 0
    const treeSitterOnlyPercent = 100 - scipCoveragePercent

    const completionSummary = {
      fileCount, functionCount, classCount,
      entitiesWritten: result.entitiesWritten, edgesWritten: result.edgesWritten,
      scipCoveragePercent, treeSitterOnlyPercent,
      highRiskNodes: blastRadius.highRiskCount,
      coChangeEdges: temporal.coChangeEdgesStored,
      totalDuration: formatMs(totalDurationMs),
      totalDurationMs, stepDurations,
      repoId: input.repoId,
      ...(input.runId && { runId: input.runId }),
    }

    await logActivities.appendPipelineLog({
      timestamp: new Date().toISOString(),
      level: "info",
      phase: "indexing",
      step: "Complete",
      message: `Indexing complete — ${fileCount} files, ${functionCount} functions, ${classCount} classes | Quality: ${scipCoveragePercent}% SCIP, ${treeSitterOnlyPercent}% tree-sitter | ${formatMs(totalDurationMs)}`,
      meta: completionSummary,
    })
    await logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId })

    if (input.runId) {
      await runActivities.completePipelineRun({
        runId: input.runId,
        status: "completed",
        fileCount, functionCount, classCount,
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

    if (input.runId) {
      await runActivities.completePipelineRun({
        runId: input.runId,
        status: "failed",
        errorMessage: message,
      })
    }

    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId, runId: input.runId }).catch(() => {})
    await lightActivities.updateRepoError(input.repoId, message)
    throw err
  } finally {
    // Phase 13: Worktree cleanup safety net.
    // If prepareRepoIntelligenceSpace created a worktree but the workflow failed
    // before pattern detection's cleanup could run, remove it here.
    // This is the "try/finally" defense — the GC cron is the second safety net.
    if (worktreeIsActive && worktreePath) {
      try {
        // Use the cleanup activity to remove the worktree on the heavy worker
        await cleanupActivities.cleanupWorkspaceFilesystem({ orgId: input.orgId, repoId: input.repoId })
      } catch {
        // Non-critical: worktree GC cron will handle orphans
        wfLog("WARN", "Worktree cleanup in finally{} failed — GC cron will handle", ctx, "Cleanup")
      }
    }
  }
}
