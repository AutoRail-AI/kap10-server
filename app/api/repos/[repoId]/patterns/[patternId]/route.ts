import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { UpdatePatternSchema } from "@/lib/patterns/schema"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const PATCH = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/\/api\/repos\/([^/]+)\/patterns\/([^/]+)/)
  const repoId = match?.[1]
  const patternId = match?.[2]
  if (!repoId || !patternId) return errorResponse("Repo ID and Pattern ID required", 400)
  const orgId = await getActiveOrgId()
  if (!orgId) return errorResponse("No organization", 400)
  const container = getContainer()

  const body = (await req.json()) as Record<string, unknown>
  const parsed = UpdatePatternSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(`Invalid update: ${parsed.error.message}`, 400)
  }

  if (parsed.data.status) {
    await container.graphStore.updatePatternStatus(orgId, patternId, parsed.data.status)
  }

  return successResponse({ id: patternId }, "Pattern updated")
})
