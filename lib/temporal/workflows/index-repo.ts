import { defineQuery, proxyActivities, setHandler } from "@temporalio/workflow"
import type * as heavy from "../activities/indexing-heavy"
import type * as light from "../activities/indexing-light"

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
    const workspace = await heavyActivities.prepareWorkspace({
      orgId: input.orgId,
      repoId: input.repoId,
      installationId: input.installationId,
      cloneUrl: input.cloneUrl,
      defaultBranch: input.defaultBranch,
    })
    progress = 25

    const scip = await heavyActivities.runSCIP({
      workspacePath: workspace.workspacePath,
      orgId: input.orgId,
      repoId: input.repoId,
    })
    progress = 50

    const parse = await heavyActivities.parseRest({
      workspacePath: workspace.workspacePath,
      orgId: input.orgId,
      repoId: input.repoId,
    })
    progress = 75

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

    const result = await lightActivities.writeToArango({
      orgId: input.orgId,
      repoId: input.repoId,
      entities: allEntities,
      edges: allEdges,
      fileCount,
      functionCount,
      classCount,
    })
    progress = 100
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await lightActivities.updateRepoError(input.repoId, message)
    throw err
  }
}
