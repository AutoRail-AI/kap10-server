import { getContainer } from "@/lib/di/container"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

export interface WriteToArangoInput {
  orgId: string
  repoId: string
  entities: EntityDoc[]
  edges: EdgeDoc[]
  fileCount: number
  functionCount: number
  classCount: number
}

export interface WriteToArangoResult {
  entitiesWritten: number
  edgesWritten: number
  fileCount: number
  functionCount: number
  classCount: number
}

export async function writeToArango(input: WriteToArangoInput): Promise<WriteToArangoResult> {
  const container = getContainer()
  if (input.entities.length > 0) {
    await container.graphStore.bulkUpsertEntities(input.orgId, input.entities)
  }
  if (input.edges.length > 0) {
    await container.graphStore.bulkUpsertEdges(input.orgId, input.edges)
  }
  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "ready",
    progress: 100,
    fileCount: input.fileCount,
    functionCount: input.functionCount,
    classCount: input.classCount,
    errorMessage: null,
  })
  return {
    entitiesWritten: input.entities.length,
    edgesWritten: input.edges.length,
    fileCount: input.fileCount,
    functionCount: input.functionCount,
    classCount: input.classCount,
  }
}

export interface DeleteRepoDataInput {
  orgId: string
  repoId: string
}

export async function updateRepoError(repoId: string, errorMessage: string): Promise<void> {
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(repoId, { status: "error", errorMessage })
}

export async function deleteRepoData(input: DeleteRepoDataInput): Promise<void> {
  const container = getContainer()
  await container.graphStore.deleteRepoData(input.orgId, input.repoId)
  await container.relationalStore.deleteRepo(input.repoId)
}
