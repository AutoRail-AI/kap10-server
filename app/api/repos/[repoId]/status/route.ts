import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/status/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) {
    return errorResponse("Repo not found", 404)
  }

  // Fetch latest pipeline run for step tracking + indexing start time
  let currentRunId: string | null = null
  let steps: unknown[] = []
  let indexingStartedAt: number | null = null
  try {
    const latestRun = await container.relationalStore.getLatestPipelineRun(orgId, repoId)
    if (latestRun) {
      currentRunId = latestRun.id
      steps = latestRun.steps
      indexingStartedAt = new Date(latestRun.startedAt).getTime()
    }
  } catch {
    // Best-effort — step tracking is supplementary
  }

  const base = {
    status: repo.status,
    progress: repo.indexProgress ?? 0,
    fileCount: repo.fileCount,
    functionCount: repo.functionCount,
    classCount: repo.classCount,
    errorMessage: repo.errorMessage,
    indexingStartedAt,
    currentRunId,
    steps,
  }

  if (repo.status !== "indexing" || !repo.workflowId) {
    return successResponse(base)
  }

  try {
    const wfStatus = await container.workflowEngine.getWorkflowStatus(repo.workflowId)
    return successResponse({
      ...base,
      status: wfStatus.status === "RUNNING" ? "indexing" : repo.status,
      progress: wfStatus.progress ?? repo.indexProgress ?? 0,
    })
  } catch {
    return successResponse(base)
  }
})
