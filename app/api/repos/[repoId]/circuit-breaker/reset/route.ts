import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { resetCircuitBreaker } from "@/lib/mcp/security/circuit-breaker"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const POST = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/circuit-breaker/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }

  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const body = (await req.json()) as { entityKey?: string }
  if (!body.entityKey) {
    return errorResponse("entityKey is required", 400)
  }

  const container = getContainer()

  try {
    await resetCircuitBreaker(container, orgId, repoId, body.entityKey)
    return successResponse({ status: "reset", entityKey: body.entityKey })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return errorResponse(message, 500)
  }
})
