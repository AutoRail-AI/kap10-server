import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

const RETRY_RATE_LIMIT_KEY = "repo-retry:"
const MAX_RETRIES_PER_HOUR = 3

export const POST = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/retry/)
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
  if (repo.status !== "error") {
    return errorResponse("Only repos in error state can be retried", 400)
  }

  const rlKey = `${RETRY_RATE_LIMIT_KEY}${orgId}:${repoId}`
  const underLimit = await container.cacheStore.rateLimit(rlKey, MAX_RETRIES_PER_HOUR, 3600)
  if (!underLimit) {
    return errorResponse("Max 3 retries per hour", 429)
  }

  const installation = await container.relationalStore.getInstallation(orgId)
  if (!installation) {
    return errorResponse("GitHub App not installed", 400)
  }

  const workflowId = `index-${orgId}-${repoId}`
  try {
    await container.workflowEngine.cancelWorkflow(workflowId)
  } catch {
    // may not be running
  }
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(message, 500)
  }
  return successResponse({ status: "indexing", workflowId })
})
