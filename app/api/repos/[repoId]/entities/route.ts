import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/entities/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const file = req.nextUrl.searchParams.get("file")
  if (!file) {
    return errorResponse("Query param file is required", 400)
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
  const entities = await container.graphStore.getEntitiesByFile(orgId, repoId, file)
  return successResponse({
    entities: entities.map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      line: e.line,
      signature: (e as { signature?: string }).signature,
    })),
  })
})
