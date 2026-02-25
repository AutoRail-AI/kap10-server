/**
 * POST /api/cli/index — Two-phase upload + indexing trigger for local repos.
 *
 * Phase 1 (request_upload): Returns a signed upload URL from Supabase Storage.
 * Phase 2 (trigger_index): Starts the indexRepo Temporal workflow.
 *
 * Called by `unerr push`.
 */

import { NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"
import { authenticateMcpRequest, isAuthError } from "@/lib/mcp/auth"

export async function POST(request: Request) {
  const container = getContainer()

  // Authenticate via API key
  const authHeader = request.headers.get("authorization")
  const authResult = await authenticateMcpRequest(
    authHeader,
    container.cacheStore,
    container.relationalStore
  )

  if (isAuthError(authResult)) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    )
  }

  const body = (await request.json()) as {
    phase: "request_upload" | "trigger_index"
    repoId: string
    uploadPath?: string
  }

  if (!body.repoId) {
    return NextResponse.json({ error: "repoId is required" }, { status: 400 })
  }

  const orgId = authResult.orgId

  const repo = await container.relationalStore.getRepo(orgId, body.repoId)
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 })
  }

  if (body.phase === "request_upload") {
    const uploadPath = `${orgId}/${body.repoId}/${Date.now()}.zip`
    const { url, token } = await container.storageProvider.generateUploadUrl(
      "cli_uploads",
      uploadPath,
      3600
    )
    return NextResponse.json({ uploadUrl: url, uploadPath, token })
  }

  if (body.phase === "trigger_index") {
    if (!body.uploadPath) {
      return NextResponse.json({ error: "uploadPath is required" }, { status: 400 })
    }

    // Mark repo as indexing
    await container.relationalStore.updateRepoStatus(body.repoId, {
      status: "indexing",
      progress: 0,
    })

    // Start indexing workflow
    const workflowId = `index-repo-${body.repoId}-${Date.now()}`
    const handle = await container.workflowEngine.startWorkflow({
      workflowFn: "indexRepoWorkflow",
      workflowId,
      args: [{
        orgId,
        repoId: body.repoId,
        provider: "local_cli",
        uploadPath: body.uploadPath,
      }],
      taskQueue: "heavy-compute-queue",
    })

    await container.relationalStore.updateRepoStatus(body.repoId, {
      status: "indexing",
      workflowId: handle.workflowId,
    })

    return NextResponse.json({ workflowId: handle.workflowId })
  }

  return NextResponse.json({ error: "Invalid phase" }, { status: 400 })
}
