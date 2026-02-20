/**
 * Phase 10a: Manually trigger graph snapshot sync for a repo.
 * POST /api/graph-snapshots/[repoId]/sync
 *
 * Starts syncLocalGraphWorkflow via Temporal (idempotent workflowId).
 */

import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const POST = withAuth(async (req: NextRequest) => {
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  // Extract repoId from URL
  const url = new URL(req.url)
  const segments = url.pathname.split("/")
  const repoIdIdx = segments.indexOf("graph-snapshots") + 1
  const repoId = segments[repoIdIdx]
  if (!repoId) {
    return errorResponse("Missing repoId", 400)
  }

  // Verify repo belongs to org
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) {
    return errorResponse("Repository not found", 404)
  }

  if (repo.status !== "ready") {
    return errorResponse("Repository must be indexed before syncing", 400)
  }

  // Start sync workflow (idempotent — reuse workflowId)
  const workflowId = `sync-${orgId}-${repoId}`
  try {
    await container.workflowEngine.startWorkflow({
      workflowId,
      workflowFn: "syncLocalGraphWorkflow",
      args: [{ orgId, repoId }],
      taskQueue: "light-llm-queue",
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // If workflow already running, that's fine — idempotent
    if (message.includes("already started") || message.includes("already running")) {
      return successResponse({ workflowId, status: "already_running" })
    }
    return errorResponse(`Failed to start sync: ${message}`, 500)
  }

  return successResponse({ workflowId, status: "started" })
})
