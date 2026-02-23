/**
 * GET /api/cli/github/repos — List available GitHub repos for the org.
 *
 * Auth: API key (Bearer kap10_sk_...)
 *
 * Returns repos accessible via GitHub App installations, excluding
 * repos already connected to kap10. Mirrors /api/repos/available
 * but uses API key auth instead of session auth.
 */

import { NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"
import { authenticateMcpRequest, isAuthError } from "@/lib/mcp/auth"

const CACHE_KEY_PREFIX = "gh-repos:"
const CACHE_TTL_SECONDS = 300

interface AvailableRepo {
  id: number
  fullName: string
  defaultBranch: string
  language: string | null
  private: boolean
  installationId: number
  accountLogin: string
}

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

  const orgId = authResult.orgId
  const installations = await container.relationalStore.getInstallations(orgId)
  if (installations.length === 0) {
    return NextResponse.json({ repos: [] })
  }

  const existing = await container.relationalStore.getRepos(orgId)
  const existingIds = new Set(
    existing.map((r) => r.githubRepoId).filter((id): id is number => id != null)
  )

  const allRepos: AvailableRepo[] = []

  for (const inst of installations) {
    const cacheKey = `${CACHE_KEY_PREFIX}${inst.installationId}`
    const cached = await container.cacheStore.get<{ repos: AvailableRepo[] }>(cacheKey)
    if (cached?.repos) {
      allRepos.push(...cached.repos.filter((r) => !existingIds.has(r.id)))
      continue
    }

    const repos = await container.gitHost.getInstallationRepos(inst.installationId)
    const mapped: AvailableRepo[] = repos.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      defaultBranch: r.defaultBranch,
      language: r.language,
      private: r.private,
      installationId: inst.installationId,
      accountLogin: inst.accountLogin,
    }))
    await container.cacheStore.set(cacheKey, { repos: mapped }, CACHE_TTL_SECONDS)
    allRepos.push(...mapped.filter((r) => !existingIds.has(r.id)))
  }

  return NextResponse.json({ repos: allRepos })
}
