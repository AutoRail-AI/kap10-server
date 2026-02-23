import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { buildHealthReport } from "@/lib/justification/health-report-builder"
import { aggregateFeatures } from "@/lib/justification/feature-aggregator"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

function computeHealthGrade(risks: Array<{ severity: string }>): "A" | "B" | "C" | "D" | "F" {
  const highCount = risks.filter((r) => r.severity === "high").length
  const mediumCount = risks.filter((r) => r.severity === "medium").length

  if (highCount >= 3) return "F"
  if (highCount >= 1) return "D"
  if (mediumCount > 3) return "C"
  if (mediumCount > 0) return "B"
  return "A"
}

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/health\/insights/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()

  // Fetch all data in parallel
  const [justifications, entities, edges] = await Promise.all([
    container.graphStore.getJustifications(orgId, repoId),
    container.graphStore.getAllEntities(orgId, repoId),
    container.graphStore.getAllEdges(orgId, repoId),
  ])

  // Aggregate features
  const features = aggregateFeatures(justifications, entities, edges, orgId, repoId)

  // Build expanded health report with all 13 risk types
  const report = buildHealthReport(justifications, features, orgId, repoId, entities, edges)

  const healthGrade = computeHealthGrade(report.risks)
  const criticalCount = report.risks.filter((r) => r.severity === "high").length

  // Count by category
  const categories: Record<string, number> = {}
  for (const risk of report.risks) {
    const cat = risk.category ?? "other"
    categories[cat] = (categories[cat] ?? 0) + 1
  }

  return successResponse({
    report,
    summary: {
      healthGrade,
      totalInsights: report.risks.length,
      criticalCount,
      categories,
    },
  })
})
