import { NextRequest, NextResponse } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { generateConventionsDocument } from "@/lib/justification/conventions-generator"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/export\/conventions/)
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

  const format = req.nextUrl.searchParams.get("format") === "cursorrules" ? "cursorrules" : "markdown"
  const markdown = await generateConventionsDocument(orgId, repoId, container.graphStore, { format })

  const filename = format === "cursorrules" ? ".cursorrules" : "TEAM_CONVENTIONS.md"
  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
})
