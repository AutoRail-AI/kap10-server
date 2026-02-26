/**
 * POST /api/repos/[repoId]/promote — convert ephemeral repo to permanent.
 * Phase 5.6: P5.6-ADV-03
 */

import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const POST = withAuth(async (req: NextRequest) => {
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

  if (!repo.ephemeral) {
    return errorResponse("Repository is already permanent", 400)
  }

  // Remove ephemeral flags
  await container.relationalStore.promoteRepo(repoId)

  return successResponse({ status: "promoted", repoId })
})
