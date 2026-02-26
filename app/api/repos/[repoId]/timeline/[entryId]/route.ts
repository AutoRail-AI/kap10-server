/**
 * Phase 5.5: Single ledger entry detail API route.
 * Returns the full LedgerEntry by ID.
 */

import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const orgId = await getActiveOrgId()
  const container = getContainer()

  // Extract repoId and entryId from URL
  const url = new URL(req.url)
  const segments = url.pathname.split("/")
  const repoIdx = segments.indexOf("repos")
  const repoId = segments[repoIdx + 1]
  const timelineIdx = segments.indexOf("timeline")
  const entryId = segments[timelineIdx + 1]

  if (!repoId) {
    return errorResponse("Missing repoId", 400)
  }
  if (!entryId) {
    return errorResponse("Missing entryId", 400)
  }

  // Verify repo belongs to org
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) {
    return errorResponse("Repository not found", 404)
  }

  const entry = await container.graphStore.getLedgerEntry(orgId, entryId)
  if (!entry) {
    return errorResponse("Ledger entry not found", 404)
  }

  // Ensure the entry belongs to this repo
  if (entry.repo_id !== repoId) {
    return errorResponse("Ledger entry not found", 404)
  }

  return successResponse(entry)
})
