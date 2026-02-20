import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async (req: NextRequest) => {
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const url = new URL(req.url)
  const owner = url.searchParams.get("owner")
  const repo = url.searchParams.get("repo")
  const installationIdParam = url.searchParams.get("installationId")

  if (!owner || !repo || !installationIdParam) {
    return errorResponse("owner, repo, and installationId query params are required", 400)
  }

  const installationId = Number(installationIdParam)
  if (Number.isNaN(installationId)) {
    return errorResponse("installationId must be a number", 400)
  }

  const container = getContainer()

  // Verify installationId belongs to the user's active org
  const installation = await container.relationalStore.getInstallationByInstallationId(installationId)
  if (!installation || installation.organizationId !== orgId) {
    return errorResponse("Installation not found for this organization", 403)
  }

  const defaultBranch = url.searchParams.get("defaultBranch") ?? "main"

  const branches = await container.gitHost.listBranches(owner, repo, installationId)

  return successResponse({ branches, defaultBranch })
})
