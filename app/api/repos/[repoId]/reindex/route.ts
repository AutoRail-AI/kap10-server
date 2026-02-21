/**
 * Phase 5: Manual re-index trigger API route.
 * POST /api/repos/[repoId]/reindex — triggers full re-index.
 * Rate limited: 1 per hour per repo.
 */

import { NextRequest } from "next/server"
import { withAuth } from "@/lib/middleware/api-handler"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { successResponse, errorResponse } from "@/lib/utils/api-response"

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

  // Rate limit: 1 re-index per hour per repo
  const rateLimitKey = `reindex:${repoId}`
  const allowed = await container.cacheStore.rateLimit(rateLimitKey, 1, 3600)
  if (!allowed) {
    return errorResponse("Re-index rate limited. Try again in 1 hour.", 429)
  }

  // Find installation for this org
  const installations = await container.relationalStore.getInstallations(orgId)
  const installation = installations[0]
  if (!installation) {
    return errorResponse("No GitHub installation found for this organization", 400)
  }

  // Trigger full re-index workflow
  const workflowId = `reindex-${orgId}-${repoId}-${Date.now()}`
  try {
    const [owner, repoName] = (repo.fullName ?? "").split("/")
    const cloneUrl = `https://github.com/${repo.fullName}.git`

    await container.workflowEngine.startWorkflow({
      workflowFn: "indexRepoWorkflow",
      workflowId,
      args: [{
        orgId,
        repoId,
        installationId: Number(installation.installationId),
        cloneUrl,
        defaultBranch: repo.defaultBranch ?? "main",
      }],
      taskQueue: "heavy-compute-queue",
    })

    // Update repo status
    await container.relationalStore.updateRepoStatus(repoId, {
      status: "indexing",
      progress: 0,
      workflowId,
    })

    return successResponse({ workflowId, status: "started" })
  } catch (error: unknown) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to start re-index",
      500
    )
  }
})
