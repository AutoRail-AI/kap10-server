import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const repoId = path.replace(/^\/api\/repos\//, "").split("/")[0]
  if (!repoId) return errorResponse("Repo ID required", 400)
  const orgId = await getActiveOrgId()
  if (!orgId) return errorResponse("No organization", 400)
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) return errorResponse("Repo not found", 404)

  const url = req.nextUrl
  const patterns = await container.graphStore.queryPatterns(orgId, {
    orgId,
    repoId,
    type: url.searchParams.get("type") as "structural" | "naming" | "error-handling" | "import" | "testing" | "custom" | undefined,
    status: url.searchParams.get("status") as "detected" | "confirmed" | "promoted" | "rejected" | undefined,
    source: url.searchParams.get("source") as "ast-grep" | "mined" | "manual" | undefined,
    language: url.searchParams.get("language") ?? undefined,
    limit: 50,
  })

  return successResponse({ patterns, count: patterns.length })
})
