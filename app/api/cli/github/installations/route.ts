/**
 * GET /api/cli/github/installations — List GitHub installations for the org.
 *
 * Auth: API key (Bearer unerr_sk_...)
 * Returns all GitHub App installations linked to the authenticated org.
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

  const installations = await container.relationalStore.getInstallations(authResult.orgId)

  return NextResponse.json({
    installations: installations.map((inst) => ({
      id: inst.id,
      installationId: inst.installationId,
      accountLogin: inst.accountLogin,
      accountType: inst.accountType,
    })),
  })
}
