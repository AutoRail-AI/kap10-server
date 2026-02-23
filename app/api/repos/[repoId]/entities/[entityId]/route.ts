import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"
import { scoreJustification } from "@/lib/justification/quality-scorer"

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
  const [callers, callees, justification] = await Promise.all([
    container.graphStore.getCallersOf(orgId, entityId),
    container.graphStore.getCalleesOf(orgId, entityId),
    container.graphStore.getJustification(orgId, entityId),
  ])

  // Compute quality score if justification exists
  let qualityScore: number | null = null
  let qualityFlags: string[] = []
  let architecturalPattern: string | null = null
  let propagatedFeatureTag: string | null = null
  let propagatedDomainConcepts: string[] | null = null

  if (justification) {
    const qs = scoreJustification(justification)
    qualityScore = qs.score
    qualityFlags = qs.flags
    architecturalPattern = (justification.architectural_pattern as string) ?? null

    // Check for propagated context (stored as metadata on justification)
    const propagated_feature = justification.propagated_feature_tag as string | undefined
    const propagated_concepts = justification.propagated_domain_concepts as string[] | undefined
    if (propagated_feature && propagated_feature !== justification.feature_tag) {
      propagatedFeatureTag = propagated_feature
    }
    if (propagated_concepts && propagated_concepts.length > 0) {
      propagatedDomainConcepts = propagated_concepts
    }
  }

  // Dead code check: no callers and not an exported/entry-point entity
  const isExported = (entity as Record<string, unknown>).exported === true
  const isEntryPoint = /\/(route|page|layout|middleware|proxy|main|index|cli)\.(ts|tsx|js|jsx)$/.test(entity.file_path)
  const isStructural = ["file", "module", "namespace", "directory", "type", "interface", "enum"].includes(entity.kind)
  const isDeadCode = !isStructural && !isExported && !isEntryPoint && callers.length === 0

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
    qualityScore,
    qualityFlags,
    architecturalPattern,
    propagatedFeatureTag,
    propagatedDomainConcepts,
    isDeadCode,
  })
})
