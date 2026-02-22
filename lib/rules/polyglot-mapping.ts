/**
 * Polyglot Mapping — cross-language rule enforcement via language_implementations edges.
 */

import type { Container } from "@/lib/di/container"
import type { RuleDoc } from "@/lib/ports/types"

export interface PolyglotMapping {
  ruleId: string
  sourceLanguage: string
  targetLanguage: string
  targetPattern?: string
}

/**
 * Find rules that apply to the given language, including polyglot rules
 * that may have implementations in other languages.
 */
export async function resolvePolyglotRules(
  container: Container,
  orgId: string,
  repoId: string,
  language: string
): Promise<RuleDoc[]> {
  // Get rules directly for this language
  const directRules = await container.graphStore.queryRules(orgId, {
    orgId,
    repoId,
    status: "active",
    language,
    limit: 50,
  })

  // Get polyglot rules (rules that apply across languages)
  const polyglotRules = await container.graphStore.queryRules(orgId, {
    orgId,
    repoId,
    status: "active",
    limit: 50,
  })

  const polyglotFiltered = polyglotRules.filter(
    (r) => r.polyglot === true && (!r.languages || r.languages.length === 0 || r.languages.includes(language))
  )

  // Merge and deduplicate
  const seen = new Set<string>()
  const merged: RuleDoc[] = []
  for (const rule of [...directRules, ...polyglotFiltered]) {
    if (!seen.has(rule.id)) {
      seen.add(rule.id)
      merged.push(rule)
    }
  }

  return merged
}
