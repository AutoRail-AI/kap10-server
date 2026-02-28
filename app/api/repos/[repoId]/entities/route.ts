import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/entities/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
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

  // If file param is provided, use the existing file-scoped query
  const file = req.nextUrl.searchParams.get("file")
  if (file) {
    const entities = await container.graphStore.getEntitiesByFile(orgId, repoId, file)

    // Enriched mode: include justifications for the annotated code viewer
    const enrich = req.nextUrl.searchParams.get("enrich") === "true"
    if (enrich) {
      const justifications = await Promise.all(
        entities.map((e) =>
          container.graphStore.getJustification(orgId, e.id).catch(() => null)
        )
      )
      return successResponse({
        entities: entities.map((e, i) => {
          const j = justifications[i]
          return {
            id: e.id,
            name: e.name,
            kind: e.kind,
            line: (e as { start_line?: number }).start_line ?? 0,
            signature: (e as { signature?: string }).signature,
            exported: (e as { exported?: boolean }).exported ?? false,
            fan_in: e.fan_in ?? null,
            fan_out: e.fan_out ?? null,
            risk_level: e.risk_level ?? null,
            justification: j
              ? {
                  taxonomy: j.taxonomy,
                  confidence: j.confidence,
                  businessPurpose: j.business_purpose,
                  featureTag: j.feature_tag,
                  domainConcepts: j.domain_concepts,
                  semanticTriples: j.semantic_triples,
                  complianceTags: j.compliance_tags,
                  architecturalPattern:
                    (j.architectural_pattern as string) ?? null,
                  reasoning:
                    ((j as Record<string, unknown>).reasoning as string) ??
                    null,
                  modelTier: j.model_tier,
                  modelUsed: j.model_used ?? null,
                }
              : null,
          }
        }),
      })
    }

    return successResponse({
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        line: (e as { start_line?: number }).start_line ?? 0,
        signature: (e as { signature?: string }).signature,
      })),
    })
  }

  // General entity listing with optional filters and pagination
  const kind = req.nextUrl.searchParams.get("kind") ?? undefined
  const taxonomy = req.nextUrl.searchParams.get("taxonomy") ?? undefined
  const featureTag = req.nextUrl.searchParams.get("featureTag") ?? undefined
  const search = req.nextUrl.searchParams.get("search") ?? undefined
  const page = Math.max(Number(req.nextUrl.searchParams.get("page") ?? "1"), 1)
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? "50"), 1), 200)
  const offset = (page - 1) * limit

  const result = await container.graphStore.getEntitiesWithJustifications(orgId, repoId, {
    kind,
    taxonomy,
    featureTag,
    search,
    offset,
    limit,
  })

  return successResponse({
    entities: result.entities.map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      file_path: e.file_path,
      line: (e as { start_line?: number }).start_line ?? 0,
      signature: (e as { signature?: string }).signature,
      justification: e.justification ? {
        taxonomy: e.justification.taxonomy,
        confidence: e.justification.confidence,
        businessPurpose: e.justification.business_purpose,
        featureTag: e.justification.feature_tag,
        domainConcepts: e.justification.domain_concepts,
      } : null,
    })),
    total: result.total,
    page,
    limit,
    totalPages: Math.ceil(result.total / limit),
  })
})
