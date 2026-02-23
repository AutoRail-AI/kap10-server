import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow"
import type * as heavy from "../activities/indexing-heavy"
import type * as light from "../activities/indexing-light"
import type * as pipelineLogs from "../activities/pipeline-logs"
import { embedRepoWorkflow } from "./embed-repo"
import { syncLocalGraphWorkflow } from "./sync-local-graph"
import { detectPatternsWorkflow } from "./detect-patterns"

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

export const getProgressQuery = defineQuery<number>("getProgress")

export interface IndexRepoInput {
  orgId: string
  repoId: string
  installationId: number
  cloneUrl: string
  defaultBranch: string
  indexVersion?: string
}

/** Workflow-safe log helper (Temporal sandbox — no require/import of Node modules) */
function wfLog(level: string, msg: string, ctx: Record<string, unknown>, step?: string) {
  const ts = new Date().toISOString()
  const orgId = ctx.organizationId ?? "-"
  const repoId = ctx.repoId ?? "-"
  const extra = { ...ctx }
  delete extra.organizationId
  delete extra.repoId
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
      meta: { ...extra, repoId: String(repoId) },
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
  const ctx = { organizationId: input.orgId, repoId: input.repoId }
  let progress = 0
  setHandler(getProgressQuery, () => progress)

  wfLog("INFO", "Indexing workflow started", { ...ctx, cloneUrl: input.cloneUrl, defaultBranch: input.defaultBranch }, "Start")

  try {
    // Step 1: Clone repo, detect languages, detect monorepo roots
    wfLog("INFO", "Step 1/7: Preparing workspace (clone + scan)", ctx, "Step 1/7")
    const workspace = await heavyActivities.prepareWorkspace({
      orgId: input.orgId,
      repoId: input.repoId,
      installationId: input.installationId,
      cloneUrl: input.cloneUrl,
      defaultBranch: input.defaultBranch,
    })
    progress = 25
    wfLog("INFO", "Step 1 complete: workspace ready", { ...ctx, languages: workspace.languages, lastSha: workspace.lastSha }, "Step 1/7")

    // Step 2: Run SCIP indexers for each detected language
    wfLog("INFO", "Step 2/7: Running SCIP indexers", ctx, "Step 2/7")
    const scip = await heavyActivities.runSCIP({
      workspacePath: workspace.workspacePath,
      orgId: input.orgId,
      repoId: input.repoId,
      languages: workspace.languages,
      workspaceRoots: workspace.workspaceRoots,
    })
    progress = 50
    wfLog("INFO", "Step 2 complete: SCIP done", { ...ctx, entities: scip.entities.length, edges: scip.edges.length, coveredFiles: scip.coveredFiles.length }, "Step 2/7")

    // Step 3: Parse remaining files with tree-sitter/regex fallback
    wfLog("INFO", "Step 3/7: Parsing remaining files", ctx, "Step 3/7")
    const parse = await heavyActivities.parseRest({
      workspacePath: workspace.workspacePath,
      orgId: input.orgId,
      repoId: input.repoId,
      coveredFiles: scip.coveredFiles,
    })
    progress = 75
    wfLog("INFO", "Step 3 complete: parsing done", { ...ctx, extraEntities: parse.extraEntities.length, extraEdges: parse.extraEdges.length }, "Step 3/7")

    // Merge entities and edges from both activities
    const allEntities = [...scip.entities, ...parse.extraEntities].map((e) => ({
      ...e,
      org_id: e.org_id ?? input.orgId,
      repo_id: e.repo_id ?? input.repoId,
    }))
    const allEdges = [...scip.edges, ...parse.extraEdges].map((e) => ({
      ...e,
      org_id: e.org_id ?? input.orgId,
      repo_id: e.repo_id ?? input.repoId,
    }))
    const fileCount = new Set(allEntities.map((e) => e.file_path)).size
    const functionCount = allEntities.filter((e) => e.kind === "function").length
    const classCount = allEntities.filter((e) => e.kind === "class").length

    // Step 4: Write to ArangoDB and update status
    wfLog("INFO", "Step 4/7: Writing to ArangoDB", { ...ctx, entityCount: allEntities.length, edgeCount: allEdges.length }, "Step 4/7")
    const result = await lightActivities.writeToArango({
      orgId: input.orgId,
      repoId: input.repoId,
      entities: allEntities,
      edges: allEdges,
      fileCount,
      functionCount,
      classCount,
      indexVersion: input.indexVersion,
    })
    progress = 95

    // Derive unique child workflow IDs from the parent run ID so re-indexing
    // never collides with previous runs
    const { runId } = workflowInfo()
    const suffix = runId.slice(0, 8)

    // Step 5: Fire-and-forget the embedding workflow (Phase 3)
    wfLog("INFO", "Step 5/7: Starting embed workflow", ctx, "Step 5/7")
    await startChild(embedRepoWorkflow, {
      workflowId: `embed-${input.orgId}-${input.repoId}-${suffix}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId, lastIndexedSha: workspace.lastSha }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })

    // Step 6: Fire-and-forget the local graph sync workflow (Phase 10a)
    wfLog("INFO", "Step 6/7: Starting graph sync workflow", ctx, "Step 6/7")
    await startChild(syncLocalGraphWorkflow, {
      workflowId: `sync-${input.orgId}-${input.repoId}-${suffix}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })

    // Step 7: Fire-and-forget pattern detection workflow (Phase 6)
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

    progress = 100
    wfLog("INFO", "Indexing workflow complete", { ...ctx, fileCount, functionCount, classCount }, "Complete")
    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId }).catch(() => {})
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    wfLog("ERROR", "Indexing workflow failed", { ...ctx, errorMessage: message }, "Error")
    logActivities.archivePipelineLogs({ orgId: input.orgId, repoId: input.repoId }).catch(() => {})
    await lightActivities.updateRepoError(input.repoId, message)
    throw err
  }
}
