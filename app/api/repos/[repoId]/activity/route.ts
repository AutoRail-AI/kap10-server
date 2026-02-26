/**
 * Phase 5: Activity feed API route.
 * Returns index events + in-flight workflow status for a repo.
 */

import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

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

  // Get index events
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100)
  const events = await container.graphStore.getIndexEvents(orgId, repoId, limit)

  // Check for in-flight workflow
  let inFlightStatus = null
  try {
    const workflowId = `incremental-${orgId}-${repoId}`
    const status = await container.workflowEngine.getWorkflowStatus(workflowId)
    if (status.status === "RUNNING") {
      inFlightStatus = {
        workflowId: status.workflowId,
        status: status.status,
        progress: status.progress,
      }
    }
  } catch {
    // No in-flight workflow
  }

  return successResponse({
    events,
    inFlightStatus,
    repo: {
      id: repo.id,
      name: repo.name,
      status: repo.status,
      lastIndexedAt: repo.lastIndexedAt,
      lastIndexedSha: repo.lastIndexedSha,
    },
  })
})
