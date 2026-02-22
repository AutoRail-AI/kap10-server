/**
 * Rule Resolver — hierarchical scope resolution for rules.
 * Resolves applicable rules for a given context: workspace > branch > path > repo > org.
 * Uses Redis caching (60s TTL), deduplicates by title, caps at 50.
 */

import type { Container } from "@/lib/di/container"
import type { RuleDoc, RuleScope } from "@/lib/ports/types"

const SCOPE_PRIORITY: Record<RuleScope, number> = {
  workspace: 5,
  branch: 4,
  path: 3,
  repo: 2,
  org: 1,
}

const CACHE_TTL_SECONDS = 60
const MAX_RULES = 50

export interface ResolveRulesInput {
  orgId: string
  repoId: string
  filePath?: string
  branch?: string
  workspaceId?: string
}

export async function resolveRules(
  container: Container,
  input: ResolveRulesInput
): Promise<RuleDoc[]> {
  const cacheKey = `rules:resolved:${input.orgId}:${input.repoId}:${input.filePath ?? ""}:${input.branch ?? ""}`

  // Check cache first
  try {
    const cached = await container.cacheStore.get<RuleDoc[]>(cacheKey)
    if (cached) return cached
  } catch {
    // cache miss or unavailable
  }

  // Query all active rules for this org+repo
  const allRules = await container.graphStore.queryRules(input.orgId, {
    orgId: input.orgId,
    repoId: input.repoId,
    status: "active",
    limit: 100,
  })

  // Filter by applicability
  const applicable = allRules.filter((rule) => {
    // Check path glob if specified
    if (rule.pathGlob && input.filePath) {
      if (!matchGlob(input.filePath, rule.pathGlob)) return false
    }
    return true
  })

  // Sort by scope priority (higher = more specific = higher priority)
  applicable.sort((a, b) => {
    const scopeDiff = (SCOPE_PRIORITY[b.scope] ?? 0) - (SCOPE_PRIORITY[a.scope] ?? 0)
    if (scopeDiff !== 0) return scopeDiff
    return (b.priority ?? 0) - (a.priority ?? 0)
  })

  // Deduplicate by title — keep the highest-priority version
  const seen = new Set<string>()
  const deduped = applicable.filter((rule) => {
    const key = rule.title.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const result = deduped.slice(0, MAX_RULES)

  // Cache the result
  try {
    await container.cacheStore.set(cacheKey, result, CACHE_TTL_SECONDS)
  } catch {
    // cache write failure is non-fatal
  }

  return result
}

/** Simple glob matching — supports * and ** patterns. */
function matchGlob(filePath: string, glob: string): boolean {
  const regex = glob
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
  return new RegExp(`^${regex}$`).test(filePath)
}
