/**
 * Phase 5: Manual re-index trigger API route.
 * POST /api/repos/[repoId]/reindex — triggers full re-index.
 * Rate limited: 1 per hour per repo.
 *
 * Clean reindex: wipes all existing graph data before writing fresh.
 * Repo status is set to "indexing" during the process.
 */

import { revalidatePath } from "next/cache"
import { NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "reindex-api" })

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

  log.info("Reindex requested", { orgId, repoId })

  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) {
    log.warn("Repository not found", { orgId, repoId })
    return errorResponse("Repository not found", 404)
  }
  log.info("Repo found", { repoId, status: repo.status, fullName: repo.fullName })

  // Block concurrent indexing: reject if any pipeline stage is currently running
  const IN_PROGRESS_STATUSES = ["indexing", "embedding", "justifying", "analyzing"]
  if (repo.status && IN_PROGRESS_STATUSES.includes(repo.status)) {
    log.warn("Indexing already in progress", { repoId, status: repo.status })
    return errorResponse(
      `Indexing already in progress (status: ${repo.status}). Wait for it to complete before re-indexing.`,
      409
    )
  }

  const rateLimitKey = `reindex:${repoId}`
  const allowed = await container.cacheStore.rateLimit(rateLimitKey, 1, 3600)
  if (!allowed) {
    log.warn("Rate limited", { repoId })
    return errorResponse("Re-index rate limited. Try again in 1 hour.", 429)
  }

  const installations = await container.relationalStore.getInstallations(orgId)
  const installation = installations[0]
  if (!installation) {
    log.warn("No GitHub installation found", { orgId })
    return errorResponse(
      "No GitHub installation found for this organization",
      400
    )
  }
  log.info("Installation found", { repoId, installationId: installation.installationId })

  const indexVersion = randomUUID()
  // Fixed workflowId (no timestamp) so Temporal rejects a second start if one is already running.
  // Status check above is the primary guard; this is a belt-and-suspenders server-side lock.
  const workflowId = `reindex-${orgId}-${repoId}`
  const runId = randomUUID()

  try {
    const cloneUrl = `https://github.com/${repo.fullName}.git`

    // Create pipeline run record
    log.info("Creating pipeline run record", { repoId, runId, workflowId })
    await container.relationalStore.createPipelineRun({
      id: runId,
      repoId,
      organizationId: orgId,
      workflowId,
      triggerType: "reindex",
      pipelineType: "full",
      indexVersion,
    })
    log.info("Pipeline run record created", { repoId, runId })

    log.info("Starting Temporal workflow", { repoId, workflowId })
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
          runId,
        },
      ],
      taskQueue: "heavy-compute-queue",
    })
    log.info("Temporal workflow started", { repoId, workflowId })

    await container.relationalStore.updateRepoStatus(repoId, {
      status: "indexing",
      progress: 0,
      workflowId,
    })
    log.info("Repo status updated to indexing", { repoId })

    revalidatePath("/repos")
    return successResponse({
      workflowId,
      runId,
      indexVersion,
      status: "started",
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to start re-index"
    log.error("Reindex failed", error instanceof Error ? error : undefined, { repoId, workflowId, runId })
    return errorResponse(msg, 500)
  }
})
