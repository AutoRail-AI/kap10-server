import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/blueprint/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()
  const features = await container.graphStore.getFeatureAggregations(orgId, repoId)
  const healthReport = await container.graphStore.getHealthReport(orgId, repoId)

  return successResponse({
    features,
    health: healthReport
      ? {
          total_entities: healthReport.total_entities,
          justified_entities: healthReport.justified_entities,
          average_confidence: healthReport.average_confidence,
          taxonomy_breakdown: healthReport.taxonomy_breakdown,
        }
      : null,
  })
})
