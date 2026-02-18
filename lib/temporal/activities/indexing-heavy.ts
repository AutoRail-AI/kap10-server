import { getContainer } from "@/lib/di/container"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

export interface PrepareWorkspaceInput {
  orgId: string
  repoId: string
  installationId: number
  cloneUrl: string
  defaultBranch: string
}

export interface PrepareWorkspaceResult {
  workspacePath: string
}

export async function prepareWorkspace(input: PrepareWorkspaceInput): Promise<PrepareWorkspaceResult> {
  const container = getContainer()
  const workspacePath = `/data/workspaces/${input.orgId}/${input.repoId}`
  await container.gitHost.cloneRepo(input.cloneUrl, workspacePath, {
    ref: input.defaultBranch,
    installationId: input.installationId,
  })
  return { workspacePath }
}

export interface RunSCIPResult {
  entities: EntityDoc[]
  edges: EdgeDoc[]
  coveredFiles: string[]
}

export async function runSCIP(_input: { workspacePath: string; orgId: string; repoId: string }): Promise<RunSCIPResult> {
  return { entities: [], edges: [], coveredFiles: [] }
}

export interface ParseRestResult {
  extraEntities: EntityDoc[]
  extraEdges: EdgeDoc[]
}

export async function parseRest(_input: { workspacePath: string; orgId: string; repoId: string }): Promise<ParseRestResult> {
  return { extraEntities: [], extraEdges: [] }
}
