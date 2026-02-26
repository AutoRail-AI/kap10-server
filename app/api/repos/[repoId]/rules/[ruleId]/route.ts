import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { UpdateRuleSchema } from "@/lib/rules/schema"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const PATCH = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/\/api\/repos\/([^/]+)\/rules\/([^/]+)/)
  const repoId = match?.[1]
  const ruleId = match?.[2]
  if (!repoId || !ruleId) return errorResponse("Repo ID and Rule ID required", 400)
  const orgId = await getActiveOrgId()
  if (!orgId) return errorResponse("No organization", 400)
  const container = getContainer()

  // Get existing rule
  const rules = await container.graphStore.queryRules(orgId, { orgId, repoId, limit: 100 })
  const existing = rules.find((r) => r.id === ruleId)
  if (!existing) return errorResponse("Rule not found", 404)

  const body = (await req.json()) as Record<string, unknown>
  const parsed = UpdateRuleSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(`Invalid update: ${parsed.error.message}`, 400)
  }

  await container.graphStore.upsertRule(orgId, {
    ...existing,
    ...parsed.data,
    updated_at: new Date().toISOString(),
  })

  return successResponse({ id: ruleId }, "Rule updated")
})

export const DELETE = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/\/api\/repos\/([^/]+)\/rules\/([^/]+)/)
  const repoId = match?.[1]
  const ruleId = match?.[2]
  if (!repoId || !ruleId) return errorResponse("Repo ID and Rule ID required", 400)
  const orgId = await getActiveOrgId()
  if (!orgId) return errorResponse("No organization", 400)
  const container = getContainer()
  await container.graphStore.deleteRule(orgId, ruleId)
  return successResponse({ id: ruleId }, "Rule deleted")
})
