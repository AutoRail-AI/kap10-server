import { defineQuery, ParentClosePolicy, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow"
import type * as heavy from "../activities/indexing-heavy"
import type * as light from "../activities/indexing-light"
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

export const getProgressQuery = defineQuery<number>("getProgress")

export interface IndexRepoInput {
  orgId: string
  repoId: string
  installationId: number
  cloneUrl: string
  defaultBranch: string
}

export async function indexRepoWorkflow(input: IndexRepoInput): Promise<{
  entitiesWritten: number
  edgesWritten: number
  fileCount: number
  functionCount: number
  classCount: number
}> {
  let progress = 0
  setHandler(getProgressQuery, () => progress)

  try {
    // Step 1: Clone repo, detect languages, detect monorepo roots
    const workspace = await heavyActivities.prepareWorkspace({
      orgId: input.orgId,
      repoId: input.repoId,
      installationId: input.installationId,
      cloneUrl: input.cloneUrl,
      defaultBranch: input.defaultBranch,
    })
    progress = 25

    // Step 2: Run SCIP indexers for each detected language
    const scip = await heavyActivities.runSCIP({
      workspacePath: workspace.workspacePath,
      orgId: input.orgId,
      repoId: input.repoId,
      languages: workspace.languages,
      workspaceRoots: workspace.workspaceRoots,
    })
    progress = 50

    // Step 3: Parse remaining files with tree-sitter/regex fallback
    const parse = await heavyActivities.parseRest({
      workspacePath: workspace.workspacePath,
      orgId: input.orgId,
      repoId: input.repoId,
      coveredFiles: scip.coveredFiles,
    })
    progress = 75

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
    const result = await lightActivities.writeToArango({
      orgId: input.orgId,
      repoId: input.repoId,
      entities: allEntities,
      edges: allEdges,
      fileCount,
      functionCount,
      classCount,
    })
    progress = 95

    // Derive unique child workflow IDs from the parent run ID so re-indexing
    // never collides with previous runs
    const { runId } = workflowInfo()
    const suffix = runId.slice(0, 8)

    // Step 5: Fire-and-forget the embedding workflow (Phase 3)
    // Uses ParentClosePolicy.ABANDON so the embed workflow runs independently
    // even if this parent workflow completes/terminates.
    await startChild(embedRepoWorkflow, {
      workflowId: `embed-${input.orgId}-${input.repoId}-${suffix}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId, lastIndexedSha: workspace.lastSha }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })

    // Step 6: Fire-and-forget the local graph sync workflow (Phase 10a)
    await startChild(syncLocalGraphWorkflow, {
      workflowId: `sync-${input.orgId}-${input.repoId}-${suffix}`,
      taskQueue: "light-llm-queue",
      args: [{ orgId: input.orgId, repoId: input.repoId }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    })

    // Step 7: Fire-and-forget pattern detection workflow (Phase 6)
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
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await lightActivities.updateRepoError(input.repoId, message)
    throw err
  }
}
