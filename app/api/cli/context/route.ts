/**
 * GET /api/cli/context — Look up a repo by git remote URL.
 *
 * Accepts ?remote=github.com/owner/repo and returns repo info
 * if it exists in the user's org. Used by the CLI connect command
 * to detect if a repo is already on kap10.
 */

import { NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"
import { authenticateMcpRequest, isAuthError } from "@/lib/mcp/auth"

export async function GET(request: Request) {
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

  const url = new URL(request.url)
  const remote = url.searchParams.get("remote")

  if (!remote) {
    return NextResponse.json(
      { error: "remote query parameter is required" },
      { status: 400 }
    )
  }

  // Parse remote URL to extract owner/repo
  // Supports: github.com/owner/repo, https://github.com/owner/repo.git, git@github.com:owner/repo.git
  const fullName = parseRemoteToFullName(remote)
  if (!fullName) {
    return NextResponse.json(
      { error: "Could not parse remote URL" },
      { status: 400 }
    )
  }

  // Look up repos in the org
  const repos = await container.relationalStore.getRepos(authResult.orgId)
  const repo = repos.find(
    (r) =>
      r.fullName.toLowerCase() === fullName.toLowerCase() ||
      r.githubFullName?.toLowerCase() === fullName.toLowerCase()
  )

  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 })
  }

  return NextResponse.json({
    repoId: repo.id,
    repoName: repo.fullName,
    status: repo.status,
    indexed: repo.status === "ready",
    defaultBranch: repo.defaultBranch,
  })
}

function parseRemoteToFullName(remote: string): string | null {
  // git@github.com:owner/repo.git
  const sshMatch = remote.match(/git@[^:]+:(.+?)(?:\.git)?$/)
  if (sshMatch) return sshMatch[1] ?? null

  // https://github.com/owner/repo.git or github.com/owner/repo
  const httpMatch = remote.match(/(?:https?:\/\/)?(?:www\.)?[^/]+\/(.+?)(?:\.git)?$/)
  if (httpMatch) return httpMatch[1] ?? null

  return null
}
