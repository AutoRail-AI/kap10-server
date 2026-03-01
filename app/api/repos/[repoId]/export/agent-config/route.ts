import { NextRequest, NextResponse } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { generateAgentMemoryFile } from "@/lib/export/agent-memory-sync"
import type { AgentFormat } from "@/lib/export/agent-memory-sync"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse } from "@/lib/utils/api-response"

const VALID_FORMATS = new Set<AgentFormat>(["claude", "cursor", "copilot"])

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/export\/agent-config/)
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

  const formatParam = req.nextUrl.searchParams.get("format") ?? "claude"
  if (!VALID_FORMATS.has(formatParam as AgentFormat)) {
    return errorResponse(`Invalid format: ${formatParam}. Valid: claude, cursor, copilot`, 400)
  }
  const format = formatParam as AgentFormat

  const result = await generateAgentMemoryFile(
    { orgId, repoId, format },
    container.graphStore
  )

  return new NextResponse(result.content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  })
})
