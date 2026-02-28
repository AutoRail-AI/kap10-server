import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

const MAX_CONTEXT_LENGTH = 10_000

export const PUT = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/context/)
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

  const body = (await req.json()) as { text?: string }
  if (!body.text || typeof body.text !== "string") {
    return errorResponse("text field is required", 400)
  }

  const trimmed = body.text.trim()
  if (trimmed.length > MAX_CONTEXT_LENGTH) {
    return errorResponse(`Context must be under ${MAX_CONTEXT_LENGTH} characters`, 400)
  }

  await container.relationalStore.updateRepoContextDocuments(repoId, trimmed || null)

  return successResponse({ saved: true, length: trimmed.length })
})

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/context/)
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

  return successResponse({
    contextDocuments: repo.contextDocuments ?? null,
  })
})
