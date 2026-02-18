import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

const CACHE_KEY_PREFIX = "gh-repos:"
const CACHE_TTL_SECONDS = 300

export const GET = withAuth(async () => {
  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const container = getContainer()
  const installation = await container.relationalStore.getInstallation(orgId)
  if (!installation) {
    return successResponse({ repos: [] })
  }

  const cacheKey = `${CACHE_KEY_PREFIX}${installation.installationId}`
  const cached = await container.cacheStore.get<{ repos: { id: number; fullName: string; defaultBranch: string; language: string | null; private: boolean }[] }>(cacheKey)
  if (cached?.repos) {
    return successResponse(cached)
  }

  const repos = await container.gitHost.getInstallationRepos(installation.installationId)
  const existing = await container.relationalStore.getRepos(orgId)
  const existingIds = new Set(existing.map((r) => r.githubRepoId).filter(Boolean))
  const filtered = repos.filter((r) => !existingIds.has(r.id))
  const payload = { repos: filtered.map((r) => ({ id: r.id, fullName: r.fullName, defaultBranch: r.defaultBranch, language: r.language, private: r.private })) }
  await container.cacheStore.set(cacheKey, payload, CACHE_TTL_SECONDS)
  return successResponse(payload)
})
