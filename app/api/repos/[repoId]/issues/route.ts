import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { FIX_GUIDANCE } from "@/lib/health/fix-guidance"
import { getReasoning, getImpact } from "@/lib/health/issue-templates"
import { buildAgentPrompt } from "@/lib/health/agent-prompt-builder"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

const SEVERITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 }
const CATEGORY_WEIGHT: Record<string, number> = {
  dead_code: 0.5,
  architecture: 1.0,
  quality: 0.6,
  complexity: 0.8,
  taxonomy: 0.3,
}

function computePriorityScore(
  severity: string,
  affectedCount: number,
  category: string
): number {
  const sevW = SEVERITY_WEIGHT[severity] ?? 1
  const catW = CATEGORY_WEIGHT[category] ?? 0.5
  return sevW * 40 + (Math.min(affectedCount, 50) / 50) * 30 + catW * 30
}

function computeHealthScore(
  risks: Array<{ severity: string }>
): number {
  if (risks.length === 0) return 100
  let penalty = 0
  for (const r of risks) {
    if (r.severity === "high") penalty += 15
    else if (r.severity === "medium") penalty += 8
    else penalty += 3
  }
  return Math.max(0, Math.round(100 - penalty))
}

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/issues/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()
  const report = await container.graphStore.getHealthReport(orgId, repoId)

  if (!report) {
    return successResponse({ status: "pending" as const, issues: [], summary: null })
  }

  const issues = report.risks.map((risk, index) => {
    const guidance = FIX_GUIDANCE[risk.riskType]
    const title = guidance?.title ?? risk.riskType.replace(/_/g, " ")
    const icon = guidance?.icon ?? "AlertTriangle"
    const category = risk.category ?? guidance?.category ?? "quality"
    const howToFix = guidance?.howToFix ?? ""
    const affectedCount = risk.affectedCount ?? risk.entities?.length ?? 1
    const entities = risk.entities ?? []

    const reasoning = getReasoning({
      riskType: risk.riskType,
      description: risk.description,
      severity: risk.severity,
      affectedCount,
      entities,
      featureTag: risk.featureTag,
    })

    const impact = getImpact({
      riskType: risk.riskType,
      description: risk.description,
      severity: risk.severity,
      affectedCount,
      entities,
      featureTag: risk.featureTag,
    })

    const agentPrompt = buildAgentPrompt({
      riskType: risk.riskType,
      title,
      entities,
      howToFix,
      affectedCount,
    })

    const priorityScore = computePriorityScore(
      risk.severity,
      affectedCount,
      category
    )

    return {
      id: `${risk.riskType}_${index}`,
      riskType: risk.riskType,
      title,
      severity: risk.severity,
      category,
      icon,
      affectedCount,
      entities,
      reasoning,
      impact,
      howToFix,
      agentPrompt,
      priorityScore,
    }
  })

  // Sort by priority score descending
  issues.sort((a, b) => b.priorityScore - a.priorityScore)

  const bySeverity = { high: 0, medium: 0, low: 0 }
  const byCategory: Record<string, number> = {}
  for (const issue of issues) {
    bySeverity[issue.severity]++
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1
  }

  return successResponse({
    issues,
    summary: {
      total: issues.length,
      bySeverity,
      byCategory,
      healthScore: computeHealthScore(report.risks),
    },
    generatedAt: report.generated_at,
  })
})
