/**
 * Phase 5.5: Ledger summaries (commit roll-ups) API route.
 * Returns AI contribution summaries grouped by commit.
 */

import { NextRequest } from "next/server"
import { withAuth } from "@/lib/middleware/api-handler"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { successResponse, errorResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const orgId = await getActiveOrgId()
  const container = getContainer()

  // Extract repoId from URL
  const url = new URL(req.url)
  const segments = url.pathname.split("/")
  const repoIdx = segments.indexOf("repos")
  const repoId = segments[repoIdx + 1]
  if (!repoId) {
    return errorResponse("Missing repoId", 400)
  }

  // Verify repo belongs to org
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) {
    return errorResponse("Repository not found", 404)
  }

  const branch = url.searchParams.get("branch") ?? undefined
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100)

  const summaries = await container.graphStore.queryLedgerSummaries(
    orgId,
    repoId,
    branch,
    limit
  )

  return successResponse(summaries)
})
