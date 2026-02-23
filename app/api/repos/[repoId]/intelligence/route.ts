import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/intelligence/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()

  try {
    // Cruft: dead code from health report
    const healthReport = await container.graphStore.getHealthReport(orgId, repoId)
    const deadCodeRisks = healthReport?.risks.filter(
      (r) => r.category === "dead_code"
    ) ?? []

    // Alignment: patterns with adherence rates
    const patterns = await container.graphStore.queryPatterns(orgId, {
      orgId,
      repoId,
      limit: 100,
    })

    const alignment = patterns.map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      type: p.type,
      adherenceRate: p.adherenceRate,
      confidence: p.confidence,
      status: p.status,
      evidenceCount: p.evidence.length,
      language: p.language,
    }))

    // Bounded context bleed (if method exists on graph store)
    let boundedContextBleed: unknown[] = []
    if ("findCrossFeatureMutations" in container.graphStore) {
      try {
        boundedContextBleed = await (
          container.graphStore as { findCrossFeatureMutations: (orgId: string, repoId: string) => Promise<unknown[]> }
        ).findCrossFeatureMutations(orgId, repoId)
      } catch {
        // Degrade gracefully
      }
    }

    return successResponse({
      cruft: {
        deadCode: deadCodeRisks,
        totalDeadCodeEntities: deadCodeRisks.reduce(
          (sum: number, r) => sum + (r.affectedCount ?? 0),
          0
        ),
      },
      alignment: {
        patterns: alignment,
        averageAdherence:
          alignment.length > 0
            ? alignment.reduce((sum: number, p) => sum + p.adherenceRate, 0) /
              alignment.length
            : 0,
      },
      boundedContextBleed,
    })
  } catch (error: unknown) {
    return errorResponse(
      error instanceof Error ? error.message : String(error),
      500
    )
  }
})
