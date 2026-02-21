import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const POST = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/health/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()

  try {
    const handle = await container.workflowEngine.startWorkflow({
      workflowId: `health-${orgId}-${repoId}`,
      workflowFn: "generateHealthReportWorkflow",
      args: [{ orgId, repoId }],
      taskQueue: "light-llm-queue",
    })

    return successResponse({
      workflowId: handle.workflowId,
      status: "started",
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("already started") || message.includes("already running")) {
      return successResponse({ status: "already_running" })
    }
    return errorResponse(message, 500)
  }
})
