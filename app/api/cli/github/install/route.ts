/**
 * POST /api/cli/github/install — Initiate GitHub App installation from CLI.
 *
 * Auth: API key (Bearer unerr_sk_...)
 *
 * Creates a state token in Redis (same as web flow) with a cliPollToken
 * so the CLI can poll for completion. Returns the GitHub App install URL
 * and poll token.
 *
 * The user opens the URL in their browser, installs the GitHub App,
 * and GitHub redirects to /api/github/callback which processes the
 * installation and signals completion via the cliPollToken in Redis.
 */

import { NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { getContainer } from "@/lib/di/container"
import { authenticateMcpRequest, isAuthError } from "@/lib/mcp/auth"

const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG ?? "unerr-dev"
const STATE_TTL_SECONDS = 600

export async function POST(request: Request) {
  const container = getContainer()

  const authResult = await authenticateMcpRequest(
    request.headers.get("authorization"),
    container.cacheStore,
    container.relationalStore
  )
  if (isAuthError(authResult)) {
    return NextResponse.json({ error: authResult.message }, { status: authResult.status })
  }

  const state = randomBytes(24).toString("hex")
  const pollToken = randomBytes(24).toString("hex")

  // Store state for GitHub callback (same key pattern as web flow)
  await container.cacheStore.set(
    `github:install:state:${state}`,
    { orgId: authResult.orgId, cliPollToken: pollToken },
    STATE_TTL_SECONDS
  )

  // Store poll state for CLI to check
  await container.cacheStore.set(
    `github:cli-install:${pollToken}`,
    { status: "pending", orgId: authResult.orgId },
    STATE_TTL_SECONDS
  )

  const installUrl = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${state}`

  return NextResponse.json({ installUrl, pollToken })
}
