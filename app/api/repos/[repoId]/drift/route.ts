import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/drift/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()
  const category = req.nextUrl.searchParams.get("category")
  const limitParam = req.nextUrl.searchParams.get("limit")
  const limit = limitParam ? parseInt(limitParam, 10) : 50

  try {
    const driftScores = await container.graphStore.getDriftScores(orgId, repoId)

    // Enrich with entity details
    const enriched = await Promise.all(
      driftScores.map(async (d) => {
        const entity = await container.graphStore.getEntity(orgId, d.entity_id)
        return {
          ...d,
          entityName: entity?.name ?? "Unknown",
          entityKind: entity?.kind ?? "unknown",
          entityFilePath: entity?.file_path ?? "",
        }
      })
    )

    // Filter by category if specified
    const filtered = category
      ? enriched.filter((d) => d.category === category)
      : enriched

    // Summary counts per category
    const summary = {
      stable: enriched.filter((d) => d.category === "stable").length,
      cosmetic: enriched.filter((d) => d.category === "cosmetic").length,
      refactor: enriched.filter((d) => d.category === "refactor").length,
      intent_drift: enriched.filter((d) => d.category === "intent_drift").length,
    }

    // Sort by detected_at descending, apply limit
    filtered.sort(
      (a, b) =>
        new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    )
    const limited = filtered.slice(0, limit)

    return successResponse({ driftScores: limited, summary })
  } catch (error: unknown) {
    return errorResponse(
      error instanceof Error ? error.message : String(error),
      500
    )
  }
})
