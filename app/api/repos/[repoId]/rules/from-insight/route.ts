import { NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { FIX_GUIDANCE } from "@/lib/health/fix-guidance"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const POST = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/rules\/from-insight/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const body = (await req.json()) as { insightType: string }
  if (!body.insightType) {
    return errorResponse("insightType is required", 400)
  }

  const guidance = FIX_GUIDANCE[body.insightType]
  if (!guidance) {
    return errorResponse(`Unknown insight type: ${body.insightType}`, 400)
  }

  const container = getContainer()
  const now = new Date().toISOString()
  const ruleId = randomUUID()

  await container.graphStore.upsertRule(orgId, {
    id: ruleId,
    org_id: orgId,
    repo_id: repoId,
    name: guidance.ruleTemplate.title.toLowerCase().replace(/\s+/g, "-"),
    title: guidance.ruleTemplate.title,
    description: guidance.ruleTemplate.description,
    type: guidance.ruleTemplate.type,
    scope: "repo",
    enforcement: guidance.ruleTemplate.enforcement,
    priority: guidance.ruleTemplate.priority,
    status: "draft",
    created_at: now,
    updated_at: now,
  })

  return successResponse({ ruleId }, "Rule created from insight", 201)
})
