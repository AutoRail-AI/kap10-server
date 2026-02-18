import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

export const GET = withAuth(async () => {
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()
  const installations = await container.relationalStore.getInstallations(orgId)

  return successResponse({
    connections: installations.map((inst) => ({
      id: inst.id,
      installationId: inst.installationId,
      accountLogin: inst.accountLogin,
      accountType: inst.accountType,
      createdAt: inst.createdAt.toISOString(),
    })),
  })
})

export const DELETE = withAuth(async (req: NextRequest) => {
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const body = (await req.json()) as { connectionId?: string }
  if (!body.connectionId) {
    return errorResponse("connectionId is required", 400)
  }

  const container = getContainer()
  const installations = await container.relationalStore.getInstallations(orgId)
  const target = installations.find((i) => i.id === body.connectionId)
  if (!target) {
    return errorResponse("Connection not found", 404)
  }

  await container.relationalStore.deleteInstallationById(target.id)

  return successResponse({ deleted: true })
})
