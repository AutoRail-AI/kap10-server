import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"
import { detectDeadCode } from "@/lib/justification/dead-code-detector"

function computeHealthGrade(risks: Array<{ severity: string }>): "A" | "B" | "C" | "D" | "F" {
  const high = risks.filter((r) => r.severity === "high").length
  const medium = risks.filter((r) => r.severity === "medium").length
  if (high >= 3) return "F"
  if (high >= 1) return "D"
  if (medium > 3) return "C"
  if (medium > 0) return "B"
  return "A"
}

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/overview/)
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
  const [healthReport, features, ontology, entities, edges] = await Promise.all([
    container.graphStore.getHealthReport(orgId, repoId).catch(() => null),
    container.graphStore.getFeatureAggregations(orgId, repoId).catch(() => []),
    container.graphStore.getDomainOntology(orgId, repoId).catch(() => null),
    container.graphStore.getAllEntities(orgId, repoId).catch(() => []),
    container.graphStore.getAllEdges(orgId, repoId).catch(() => []),
  ])

  // Compute dead code count
  let deadCodeCount = 0
  if (entities.length > 0 && edges.length > 0) {
    deadCodeCount = detectDeadCode(entities, edges).size
  }

  // Health grade from stored report
  const healthGrade = healthReport
    ? computeHealthGrade(healthReport.risks)
    : null

  // Top 3 insights from stored report
  const topInsights = healthReport
    ? [...healthReport.risks]
        .sort((a, b) => {
          const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
          return (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2)
        })
        .slice(0, 3)
        .map((r) => ({
          riskType: r.riskType,
          severity: r.severity,
          description: r.description,
          affectedCount: r.affectedCount,
        }))
    : []

  // Domain terms from ontology
  const domainTerms = ontology?.terms
    ? [...ontology.terms]
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 12)
        .map((t) => ({ term: t.term, frequency: t.frequency }))
    : []

  // Average confidence
  const avgConfidence = healthReport?.average_confidence ?? 0

  // Taxonomy breakdown
  const taxonomyBreakdown = healthReport?.taxonomy_breakdown ?? {}

  return successResponse({
    healthGrade,
    stats: {
      totalEntities: entities.length,
      featuresDiscovered: features.length,
      deadCodeCount,
      insightsFound: healthReport?.risks.length ?? 0,
      avgConfidence,
    },
    topInsights,
    domainTerms,
    taxonomyBreakdown,
    projectDescription: ontology?.project_description ?? null,
    techStack: ontology?.tech_stack ?? [],
  })
})
