import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

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

export const GET = withAuth(async () => {
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()
  const installations = await container.relationalStore.getInstallations(orgId)
  if (installations.length === 0) {
    return successResponse({ repos: [] })
  }

  const existing = await container.relationalStore.getRepos(orgId)
  const existingIds = new Set(existing.map((r) => r.githubRepoId).filter(Boolean))

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

  return successResponse({ repos: allRepos })
})
