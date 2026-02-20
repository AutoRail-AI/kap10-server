import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const parts = path.replace(/^\/api\/repos\//, "").split("/")
  const repoId = parts[0]
  const entityId = parts[2]
  if (!repoId || !entityId) {
    return errorResponse("Repo ID and entity ID required", 400)
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
  const entity = await container.graphStore.getEntity(orgId, entityId)
  if (!entity) {
    return errorResponse("Entity not found", 404)
  }
  const [callers, callees] = await Promise.all([
    container.graphStore.getCallersOf(orgId, entityId),
    container.graphStore.getCalleesOf(orgId, entityId),
  ])
  return successResponse({
    entity: {
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      file_path: entity.file_path,
      line: (entity as { start_line?: number }).start_line ?? 0,
      signature: (entity as { signature?: string }).signature,
    },
    callers: callers.map((c) => ({ id: c.id, name: c.name, file_path: c.file_path, kind: c.kind })),
    callees: callees.map((c) => ({ id: c.id, name: c.name, file_path: c.file_path, kind: c.kind })),
  })
})
