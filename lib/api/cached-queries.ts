import { unstable_cache } from "next/cache"
import { getContainer } from "@/lib/di/container"

/**
 * Cross-request cached queries for data that rarely changes.
 *
 * Unlike React's cache() which deduplicates within a single request,
 * unstable_cache persists across HTTP requests using Next.js Data Cache.
 * This eliminates redundant DB calls when multiple users/requests access
 * the same data within the revalidation window.
 *
 * Cache invalidation: use revalidateTag("repo:{repoId}") from server actions
 * after mutations (reindex, stop, retry, delete).
 */

/**
 * Cached repo list — 30s TTL.
 * Invalidate with: revalidateTag(`repos:${orgId}`)
 */
export const getReposCached = unstable_cache(
  async (orgId: string) => {
    const container = getContainer()
    return container.relationalStore.getRepos(orgId)
  },
  ["repos"],
  { revalidate: 30, tags: ["repos"] }
)

/**
 * Cached repo metadata — 15s TTL.
 * Short TTL because status changes during pipeline.
 * Invalidate with: revalidateTag(`repo:${repoId}`)
 */
export const getRepoCached = unstable_cache(
  async (orgId: string, repoId: string) => {
    const container = getContainer()
    return container.relationalStore.getRepo(orgId, repoId)
  },
  ["repo"],
  { revalidate: 15 }
)

/**
 * Cached project stats — 60s TTL.
 * Graph stats only change after indexing completes.
 * Invalidate with: revalidateTag(`stats:${repoId}`)
 */
export const getProjectStatsCached = unstable_cache(
  async (orgId: string, repoId: string) => {
    const container = getContainer()
    return container.graphStore.getProjectStats(orgId, repoId).catch(() => null)
  },
  ["project-stats"],
  { revalidate: 60 }
)

/**
 * Cached rules count — 60s TTL.
 * Rules change infrequently (manual or after pattern mining).
 */
export const getActiveRulesCached = unstable_cache(
  async (orgId: string, repoId: string) => {
    const container = getContainer()
    return container.graphStore
      .queryRules(orgId, { orgId, repoId, status: "active", limit: 100 })
      .catch(() => [])
  },
  ["active-rules"],
  { revalidate: 60 }
)

/**
 * Cached patterns count — 60s TTL.
 * Patterns change infrequently.
 */
export const getPatternsCached = unstable_cache(
  async (orgId: string, repoId: string) => {
    const container = getContainer()
    return container.graphStore
      .queryPatterns(orgId, { orgId, repoId, limit: 100 })
      .catch(() => [])
  },
  ["patterns"],
  { revalidate: 60 }
)
