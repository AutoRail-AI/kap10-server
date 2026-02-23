import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"
import { buildBlastRadiusSummary } from "@/lib/review/blast-radius"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/impact/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()
  const entityId = req.nextUrl.searchParams.get("entityId")

  if (entityId) {
    // Single entity blast radius
    const entity = await container.graphStore.getEntity(orgId, entityId)
    if (!entity) {
      return errorResponse("Entity not found", 404)
    }

    try {
      const blastRadius = await buildBlastRadiusSummary(
        orgId,
        [entity],
        container.graphStore
      )
      return successResponse({ blastRadius })
    } catch (error: unknown) {
      return errorResponse(
        error instanceof Error ? error.message : String(error),
        500
      )
    }
  }

  // Top 20 most-called entities
  try {
    const allEntities = await container.graphStore.getAllEntities(orgId, repoId)
    const functionEntities = allEntities.filter(
      (e) => e.kind === "function" || e.kind === "method"
    )

    // Get caller counts for each function/method
    const entitiesWithCallers: Array<{
      id: string
      name: string
      kind: string
      filePath: string
      callerCount: number
    }> = []

    for (const entity of functionEntities.slice(0, 100)) {
      try {
        const callers = await container.graphStore.getCallersOf(orgId, entity.id)
        entitiesWithCallers.push({
          id: entity.id,
          name: entity.name,
          kind: entity.kind,
          filePath: entity.file_path,
          callerCount: callers.length,
        })
      } catch {
        // Skip entities with graph traversal errors
      }
    }

    // Sort by caller count descending, take top 20
    entitiesWithCallers.sort((a, b) => b.callerCount - a.callerCount)
    const topEntities = entitiesWithCallers.slice(0, 20)

    return successResponse({ topEntities })
  } catch (error: unknown) {
    return errorResponse(
      error instanceof Error ? error.message : String(error),
      500
    )
  }
})
