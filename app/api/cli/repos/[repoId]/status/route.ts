/**
 * GET /api/cli/repos/[repoId]/status — Poll repo indexing status.
 *
 * Auth: API key (Bearer kap10_sk_...)
 *
 * Returns the current status of a repo (pending, indexing, ready, error)
 * along with progress and entity counts when available.
 */

import { NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"
import { authenticateMcpRequest, isAuthError } from "@/lib/mcp/auth"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const container = getContainer()

  const authResult = await authenticateMcpRequest(
    request.headers.get("authorization"),
    container.cacheStore,
    container.relationalStore
  )
  if (isAuthError(authResult)) {
    return NextResponse.json({ error: authResult.message }, { status: authResult.status })
  }

  const { repoId } = await params
  const repo = await container.relationalStore.getRepo(authResult.orgId, repoId)

  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 })
  }

  return NextResponse.json({
    repoId: repo.id,
    name: repo.name,
    fullName: repo.fullName,
    status: repo.status,
    progress: repo.indexProgress ?? null,
    fileCount: repo.fileCount ?? null,
    functionCount: repo.functionCount ?? null,
    classCount: repo.classCount ?? null,
    errorMessage: repo.errorMessage ?? null,
    lastIndexedAt: repo.lastIndexedAt?.toISOString() ?? null,
  })
}
