import { revalidatePath } from "next/cache"
import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const repoId = path.replace(/^\/api\/repos\//, "").replace(/\/$/, "").split("/")[0]
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
  return successResponse(repo)
})

export const DELETE = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)$/)
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
  await container.relationalStore.updateRepoStatus(repoId, { status: "deleting" })
  try {
    // Cancel all running workflows for this repo (catches non-deterministic IDs like justify-*-runId)
    try {
      await container.workflowEngine.cancelAllRepoWorkflows(orgId, repoId)
    } catch {
      // workflow engine may be unavailable
    }
    await container.workflowEngine.startWorkflow({
      workflowId: `delete-${orgId}-${repoId}`,
      workflowFn: "deleteRepoWorkflow",
      args: [{ orgId, repoId }],
      taskQueue: "light-llm-queue",
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(message, 500)
  }
  revalidatePath("/repos")
  return successResponse({ status: "deleting" })
})
