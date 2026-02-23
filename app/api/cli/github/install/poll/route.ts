/**
 * GET /api/cli/github/install/poll — Poll GitHub App installation status.
 *
 * Auth: API key (Bearer kap10_sk_...)
 * Query: ?token=<pollToken>
 *
 * Returns { status: "pending" } while the user hasn't completed installation,
 * or { status: "complete", installationId, accountLogin } once done.
 */

import { NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"
import { authenticateMcpRequest, isAuthError } from "@/lib/mcp/auth"

export async function GET(request: Request) {
  const container = getContainer()

  const authResult = await authenticateMcpRequest(
    request.headers.get("authorization"),
    container.cacheStore,
    container.relationalStore
  )
  if (isAuthError(authResult)) {
    return NextResponse.json({ error: authResult.message }, { status: authResult.status })
  }

  const url = new URL(request.url)
  const token = url.searchParams.get("token")
  if (!token) {
    return NextResponse.json({ error: "token query parameter is required" }, { status: 400 })
  }

  const pollState = await container.cacheStore.get<{
    status: string
    orgId: string
    installationId?: number
    accountLogin?: string
    accountType?: string
  }>(`github:cli-install:${token}`)

  if (!pollState) {
    return NextResponse.json({ error: "Poll token not found or expired" }, { status: 404 })
  }

  if (pollState.orgId !== authResult.orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  return NextResponse.json({
    status: pollState.status,
    ...(pollState.status === "complete" && {
      installationId: pollState.installationId,
      accountLogin: pollState.accountLogin,
      accountType: pollState.accountType,
    }),
  })
}
