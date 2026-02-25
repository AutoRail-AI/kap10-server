/**
 * POST /api/cli/init — Register a local repo with unerr.
 *
 * Creates (or returns existing) a repo record for the authenticated org
 * with provider="local_cli". Called by `unerr init`.
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
    name: string
    fullName?: string
    branch?: string
  }

  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }

  const orgId = authResult.orgId

  // Check if repo already exists for this org with same name
  const existingRepos = await container.relationalStore.getRepos(orgId)
  const existing = existingRepos.find(
    (r) => r.name === body.name && r.provider === "local_cli"
  )
  if (existing) {
    return NextResponse.json({ repoId: existing.id, orgId })
  }

  const repo = await container.relationalStore.createRepo({
    organizationId: orgId,
    name: body.name,
    fullName: body.fullName ?? body.name,
    provider: "local_cli",
    providerId: `local:${body.name}:${Date.now()}`,
    defaultBranch: body.branch ?? "main",
  })

  return NextResponse.json({ repoId: repo.id, orgId })
}
