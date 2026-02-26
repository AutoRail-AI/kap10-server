import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { CreateRuleSchema } from "@/lib/rules/schema"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async () => {
  const orgId = await getActiveOrgId()
  if (!orgId) return errorResponse("No organization", 400)
  const container = getContainer()

  const rules = await container.graphStore.queryRules(orgId, {
    orgId,
    scope: "org",
    status: "active",
    limit: 100,
  })

  return successResponse({ rules, count: rules.length })
})

export const POST = withAuth(async (req: NextRequest) => {
  const orgId = await getActiveOrgId()
  if (!orgId) return errorResponse("No organization", 400)
  const container = getContainer()

  const body = (await req.json()) as Record<string, unknown>
  const parsed = CreateRuleSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(`Invalid rule: ${parsed.error.message}`, 400)
  }

  const crypto = require("node:crypto") as typeof import("node:crypto")
  const ruleId = crypto.randomUUID().slice(0, 16)
  const now = new Date().toISOString()

  await container.graphStore.upsertRule(orgId, {
    id: ruleId,
    org_id: orgId,
    name: parsed.data.title.toLowerCase().replace(/\s+/g, "-"),
    title: parsed.data.title,
    description: parsed.data.description,
    type: parsed.data.type,
    scope: "org",
    pathGlob: parsed.data.pathGlob,
    fileTypes: parsed.data.fileTypes,
    entityKinds: parsed.data.entityKinds,
    enforcement: parsed.data.enforcement,
    semgrepRule: parsed.data.semgrepRule,
    astGrepQuery: parsed.data.astGrepQuery,
    astGrepFix: parsed.data.astGrepFix,
    priority: parsed.data.priority,
    status: parsed.data.status,
    polyglot: parsed.data.polyglot,
    languages: parsed.data.languages,
    created_at: now,
    updated_at: now,
  })

  return successResponse({ id: ruleId }, "Org-level rule created", 201)
})
