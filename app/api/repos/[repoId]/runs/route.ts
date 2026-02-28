/**
 * GET /api/repos/[repoId]/runs — Paginated pipeline run history.
 * Query params: ?limit=20&status=failed
 */
import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/runs/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }

  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10)
  const status = req.nextUrl.searchParams.get("status") ?? undefined

  const container = getContainer()
  const runs = await container.relationalStore.getPipelineRunsForRepo(orgId, repoId, {
    limit: Math.min(limit, 100),
    status,
  })

  return successResponse({ runs })
})
