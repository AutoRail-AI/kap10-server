/**
 * Phase 5: Manual re-index trigger API route.
 * POST /api/repos/[repoId]/reindex — triggers full re-index.
 * Rate limited: 1 per hour per repo.
 *
 * Shadow reindexing: generates an indexVersion UUID so the pipeline writes
 * new data alongside existing data. The repo stays "ready" during reindex
 * so the dashboard remains fully functional. Old data is cleaned up after
 * the new index is written.
 */

import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { withAuth } from "@/lib/middleware/api-handler"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const POST = withAuth(async (req: NextRequest) => {
  const orgId = await getActiveOrgId()
  const container = getContainer()

  const url = new URL(req.url)
  const segments = url.pathname.split("/")
  const repoIdx = segments.indexOf("repos")
  const repoId = segments[repoIdx + 1]
  if (!repoId) {
    return errorResponse("Missing repoId", 400)
  }

  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) {
    return errorResponse("Repository not found", 404)
  }

  const rateLimitKey = `reindex:${repoId}`
  const allowed = await container.cacheStore.rateLimit(rateLimitKey, 1, 3600)
  if (!allowed) {
    return errorResponse("Re-index rate limited. Try again in 1 hour.", 429)
  }

  const installations = await container.relationalStore.getInstallations(orgId)
  const installation = installations[0]
  if (!installation) {
    return errorResponse(
      "No GitHub installation found for this organization",
      400
    )
  }

  const indexVersion = randomUUID()
  const workflowId = `reindex-${orgId}-${repoId}-${Date.now()}`

  try {
    const cloneUrl = `https://github.com/${repo.fullName}.git`

    await container.workflowEngine.startWorkflow({
      workflowFn: "indexRepoWorkflow",
      workflowId,
      args: [
        {
          orgId,
          repoId,
          installationId: Number(installation.installationId),
          cloneUrl,
          defaultBranch: repo.defaultBranch ?? "main",
          indexVersion,
        },
      ],
      taskQueue: "heavy-compute-queue",
    })

    const startedAt = new Date()
    if (repo.status === "ready") {
      await container.relationalStore.updateRepoStatus(repoId, {
        status: "ready",
        progress: 0,
        workflowId,
        indexingStartedAt: startedAt,
      })
    } else {
      await container.relationalStore.updateRepoStatus(repoId, {
        status: "indexing",
        progress: 0,
        workflowId,
        indexingStartedAt: startedAt,
      })
    }

    return successResponse({
      workflowId,
      indexVersion,
      status: "started",
      shadow: repo.status === "ready",
    })
  } catch (error: unknown) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to start re-index",
      500
    )
  }
})
