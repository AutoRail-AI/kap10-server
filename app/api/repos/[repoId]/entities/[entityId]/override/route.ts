import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

const VALID_TAXONOMIES = ["VERTICAL", "HORIZONTAL", "UTILITY"] as const

export const POST = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/entities\/([^/]+)\/override/)
  const repoId = match?.[1]
  const entityId = match?.[2]
  if (!repoId || !entityId) {
    return errorResponse("Repo ID and Entity ID required", 400)
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

  const body = (await req.json()) as {
    taxonomy?: string
    featureTag?: string
    businessPurpose?: string
  }

  if (!body.taxonomy || !VALID_TAXONOMIES.includes(body.taxonomy as typeof VALID_TAXONOMIES[number])) {
    return errorResponse(`taxonomy must be one of: ${VALID_TAXONOMIES.join(", ")}`, 400)
  }

  // Fetch existing justification
  const existing = await container.graphStore.getJustification(orgId, entityId).catch(() => null)

  const now = new Date().toISOString()
  const overridden = {
    id: existing?.id ?? randomUUID(),
    org_id: orgId,
    repo_id: repoId,
    entity_id: entityId,
    taxonomy: body.taxonomy as "VERTICAL" | "HORIZONTAL" | "UTILITY",
    confidence: 1.0,
    business_purpose: body.businessPurpose ?? existing?.business_purpose ?? "Human override",
    domain_concepts: existing?.domain_concepts ?? [],
    feature_tag: body.featureTag ?? existing?.feature_tag ?? "unclassified",
    semantic_triples: existing?.semantic_triples ?? [],
    compliance_tags: existing?.compliance_tags ?? [],
    architectural_pattern: existing?.architectural_pattern,
    model_tier: "heuristic" as const,
    model_used: "human_override",
    valid_from: now,
    valid_to: null,
    created_at: now,
  }

  await container.graphStore.bulkUpsertJustifications(orgId, [overridden])

  return successResponse({
    justification: {
      taxonomy: overridden.taxonomy,
      confidence: overridden.confidence,
      businessPurpose: overridden.business_purpose,
      featureTag: overridden.feature_tag,
      domainConcepts: overridden.domain_concepts,
      modelUsed: overridden.model_used,
    },
  })
})
