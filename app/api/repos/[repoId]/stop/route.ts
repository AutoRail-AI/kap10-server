import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const POST = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/stop/)
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
  const stopAllowed = ["indexing", "embedding", "justifying", "ontology", "pending"]
  if (!stopAllowed.includes(repo.status)) {
    return errorResponse(
      `Cannot stop: repo is in '${repo.status}' state. Only active pipeline states can be stopped.`,
      400
    )
  }

  const workflowId = repo.workflowId ?? `index-${orgId}-${repoId}`
  try {
    await container.workflowEngine.cancelWorkflow(workflowId)
  } catch {
    // workflow may already be done
  }

  await container.relationalStore.updateRepoStatus(repoId, {
    status: "error",
    errorMessage: "Stopped by user",
    workflowId: null,
  })

  return successResponse({ status: "stopped" })
})
