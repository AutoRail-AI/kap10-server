import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"
import { CreateRuleExceptionSchema } from "@/lib/rules/schema"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/\/api\/repos\/([^/]+)\/rules\/([^/]+)\/exceptions/)
  const ruleId = match?.[2]
  if (!ruleId) return errorResponse("Rule ID required", 400)
  const orgId = await getActiveOrgId()
  if (!orgId) return errorResponse("No organization", 400)
  const container = getContainer()

  const exceptions = await container.graphStore.queryRuleExceptions(orgId, ruleId)
  return successResponse({ exceptions, count: exceptions.length })
})

export const POST = withAuth(async (req: NextRequest, context) => {
  const path = req.nextUrl.pathname
  const match = path.match(/\/api\/repos\/([^/]+)\/rules\/([^/]+)\/exceptions/)
  const ruleId = match?.[2]
  if (!ruleId) return errorResponse("Rule ID required", 400)
  const orgId = await getActiveOrgId()
  if (!orgId) return errorResponse("No organization", 400)
  const container = getContainer()

  const body = (await req.json()) as Record<string, unknown>
  const parsed = CreateRuleExceptionSchema.safeParse({ ...body, ruleId })
  if (!parsed.success) {
    return errorResponse(`Invalid exception: ${parsed.error.message}`, 400)
  }

  const crypto = require("node:crypto") as typeof import("node:crypto")
  const exceptionId = crypto.randomUUID().slice(0, 16)
  const ttlDays = parsed.data.ttlDays ?? 30
  const now = new Date()

  await container.graphStore.upsertRuleException(orgId, {
    id: exceptionId,
    org_id: orgId,
    rule_id: ruleId,
    entity_id: parsed.data.entityId,
    file_path: parsed.data.filePath,
    reason: parsed.data.reason,
    created_by: context.userId,
    expires_at: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
    status: "active",
    created_at: now.toISOString(),
  })

  return successResponse({ id: exceptionId }, "Exception created", 201)
})
