import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"
import { logger } from "@/lib/utils/logger"

const RETRY_RATE_LIMIT_KEY = "repo-retry:"
const MAX_RETRIES_PER_HOUR = 3
const RETRYABLE_STATUSES = ["error", "ready", "embed_failed", "justify_failed"]

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/retry/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }
  const orgId = await getActiveOrgId()
  if (!orgId) {
    logger.warn("Retry failed: no active organization", { userId, repoId })
    return errorResponse("No organization", 400)
  }

  const ctx = { userId, organizationId: orgId, repoId }
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) {
    logger.warn("Retry failed: repo not found", ctx)
    return errorResponse("Repo not found", 404)
  }
  if (!RETRYABLE_STATUSES.includes(repo.status)) {
    logger.warn("Retry failed: repo not in retryable state", { ...ctx, currentStatus: repo.status })
    return errorResponse(`Repo in '${repo.status}' state cannot be retried. Allowed: ${RETRYABLE_STATUSES.join(", ")}`, 400)
  }

  const rlKey = `${RETRY_RATE_LIMIT_KEY}${orgId}:${repoId}`
  const underLimit = await container.cacheStore.rateLimit(rlKey, MAX_RETRIES_PER_HOUR, 3600)
  if (!underLimit) {
    logger.warn("Retry rate-limited", ctx)
    return errorResponse("Max 3 retries per hour", 429)
  }

  const installations = await container.relationalStore.getInstallations(orgId)
  if (installations.length === 0) {
    logger.warn("Retry failed: no GitHub installation", ctx)
    return errorResponse("GitHub App not installed", 400)
  }

  const repoOwner = (repo.fullName ?? repo.githubFullName ?? "").split("/")[0] ?? ""
  const installation =
    installations.find((i) => i.accountLogin === repoOwner) ?? installations[0]
  if (!installation) {
    logger.warn("Retry failed: no matching GitHub installation", { ...ctx, repoOwner })
    return errorResponse("No matching GitHub installation", 400)
  }

  // Cancel any existing workflow for this repo before starting a new one
  const oldWorkflowId = repo.workflowId ?? `index-${orgId}-${repoId}`
  try {
    await container.workflowEngine.cancelWorkflow(oldWorkflowId)
    logger.info("Cancelled previous workflow", { ...ctx, oldWorkflowId })
  } catch {
    // may not be running
  }
  const workflowId = `index-${orgId}-${repoId}-${Date.now()}`
  try {
    await container.workflowEngine.startWorkflow({
      workflowId,
      workflowFn: "indexRepoWorkflow",
      args: [{
        orgId,
        repoId,
        installationId: installation.installationId,
        cloneUrl: `https://github.com/${repo.fullName ?? repo.githubFullName ?? "unknown/repo"}.git`,
        defaultBranch: repo.defaultBranch ?? "main",
      }],
      taskQueue: "heavy-compute-queue",
    })
    await container.relationalStore.updateRepoStatus(repoId, {
      status: "indexing",
      workflowId,
      errorMessage: null,
    })
    logger.info("Retry started: indexing workflow launched", { ...ctx, workflowId, previousStatus: repo.status })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error("Retry failed: workflow start error", err instanceof Error ? err : undefined, { ...ctx, workflowId })
    return errorResponse(message, 500)
  }
  return successResponse({ status: "indexing", workflowId })
})
