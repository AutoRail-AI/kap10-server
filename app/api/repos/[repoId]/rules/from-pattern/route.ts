import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { PromotePatternSchema } from "@/lib/patterns/schema"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const POST = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const repoId = path.replace(/^\/api\/repos\//, "").split("/")[0]
  if (!repoId) return errorResponse("Repo ID required", 400)
  const orgId = await getActiveOrgId()
  if (!orgId) return errorResponse("No organization", 400)
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) return errorResponse("Repo not found", 404)

  const body = (await req.json()) as Record<string, unknown>
  const parsed = PromotePatternSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(`Invalid input: ${parsed.error.message}`, 400)
  }

  // Get the pattern
  const pattern = await container.graphStore.getPatternByHash(orgId, repoId, parsed.data.patternId)
  if (!pattern) return errorResponse("Pattern not found", 404)

  // Create rule from pattern
  const crypto = require("node:crypto") as typeof import("node:crypto")
  const ruleId = crypto.randomUUID().slice(0, 16)
  const now = new Date().toISOString()

  await container.graphStore.upsertRule(orgId, {
    id: ruleId,
    org_id: orgId,
    repo_id: repoId,
    name: pattern.name,
    title: pattern.title,
    description: `Promoted from detected pattern: ${pattern.title} (${Math.round(pattern.adherenceRate * 100)}% adherence)`,
    type: pattern.type === "structural" ? "architecture" : pattern.type === "naming" ? "naming" : "style",
    scope: parsed.data.scope,
    enforcement: parsed.data.enforcement,
    astGrepQuery: pattern.astGrepQuery,
    priority: parsed.data.priority,
    status: "active",
    languages: pattern.language ? [pattern.language] : [],
    created_at: now,
    updated_at: now,
  })

  // Update pattern status to promoted
  await container.graphStore.updatePatternStatus(orgId, pattern.id, "promoted")

  return successResponse({ ruleId, patternId: pattern.id }, "Pattern promoted to rule", 201)
})
