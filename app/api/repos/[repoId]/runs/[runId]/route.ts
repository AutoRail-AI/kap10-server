/**
 * GET /api/repos/[repoId]/runs/[runId] — Single pipeline run with full step detail.
 */
import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/runs\/([^/]+)/)
  const repoId = match?.[1]
  const runId = match?.[2]
  if (!repoId || !runId) {
    return errorResponse("Repo ID and Run ID required", 400)
  }

  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()
  const run = await container.relationalStore.getPipelineRun(runId)
  if (!run || run.organizationId !== orgId || run.repoId !== repoId) {
    return errorResponse("Pipeline run not found", 404)
  }

  return successResponse({ run })
})
