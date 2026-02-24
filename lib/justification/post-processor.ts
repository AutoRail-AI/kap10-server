/**
 * Phase 4: Post-Processor — normalizes justifications, deduplicates features,
 * extracts semantic triples, and adds bi-temporal metadata.
 */

import type { JustificationDoc, FeatureAggregation } from "@/lib/ports/types"
import type { SemanticTriple } from "./schemas"

/**
 * Normalize justifications: deduplicate feature tags, ensure consistent naming,
 * and merge semantically similar tags.
 */
export function normalizeJustifications(
  justifications: JustificationDoc[]
): JustificationDoc[] {
  // First pass: normalize feature tags, domain concepts, compliance tags
  const normalized = justifications.map((j) => ({
    ...j,
    feature_tag: normalizeFeatureTag(j.feature_tag),
    domain_concepts: j.domain_concepts.map((c) => c.toLowerCase().trim()),
    compliance_tags: j.compliance_tags.map((t) => t.toUpperCase().trim()),
  }))

  // Second pass: merge semantically similar feature tags
  const mergeMap = buildTagMergeMap(normalized.map((j) => j.feature_tag))
  if (mergeMap.size > 0) {
    for (const j of normalized) {
      const merged = mergeMap.get(j.feature_tag)
      if (merged) {
        j.feature_tag = merged
      }
    }
  }

  return normalized
}

/**
 * Normalize a feature tag to consistent format.
 */
function normalizeFeatureTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Use single-row optimization
  const bLen = b.length
  let prev = Array.from({ length: bLen + 1 }, (_, i) => i)
  let curr = new Array<number>(bLen + 1)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,         // deletion
        (curr[j - 1] ?? 0) + 1,     // insertion
        (prev[j - 1] ?? 0) + cost   // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[bLen] ?? 0
}

/**
 * Compute normalized similarity (0.0 = identical, 1.0 = completely different)
 * based on Levenshtein distance.
 */
function tagSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1.0
  return 1.0 - levenshteinDistance(a, b) / maxLen
}

/** Similarity threshold above which two tags are considered the same concept */
const TAG_MERGE_THRESHOLD = 0.75

/**
 * Build a merge map for semantically similar feature tags.
 *
 * Groups similar tags (e.g., "user_auth", "user_authentication", "auth_user")
 * and maps smaller clusters to the most frequent tag in their cluster.
 * Only merges tags that are above the similarity threshold to avoid
 * collapsing genuinely different concepts.
 */
function buildTagMergeMap(tags: string[]): Map<string, string> {
  // Count tag frequency
  const freq = new Map<string, number>()
  for (const tag of tags) {
    freq.set(tag, (freq.get(tag) ?? 0) + 1)
  }

  const uniqueTags = Array.from(freq.keys())
  if (uniqueTags.length <= 1) return new Map()

  // Build clusters via single-linkage clustering
  const clusters: Set<string>[] = []
  const assigned = new Set<string>()

  for (const tag of uniqueTags) {
    if (assigned.has(tag)) continue

    const cluster = new Set<string>([tag])
    assigned.add(tag)

    // Find all similar unassigned tags
    for (const other of uniqueTags) {
      if (assigned.has(other)) continue
      // Check similarity against any member of the cluster
      let similar = false
      for (const member of Array.from(cluster)) {
        if (tagSimilarity(member, other) >= TAG_MERGE_THRESHOLD) {
          similar = true
          break
        }
      }
      if (similar) {
        cluster.add(other)
        assigned.add(other)
      }
    }

    if (cluster.size > 1) {
      clusters.push(cluster)
    }
  }

  // Build merge map: map all cluster members to the most frequent tag
  const mergeMap = new Map<string, string>()
  for (const cluster of clusters) {
    let canonical = ""
    let maxFreq = 0
    for (const tag of Array.from(cluster)) {
      const f = freq.get(tag) ?? 0
      if (f > maxFreq || (f === maxFreq && tag < canonical)) {
        canonical = tag
        maxFreq = f
      }
    }
    for (const tag of Array.from(cluster)) {
      if (tag !== canonical) {
        mergeMap.set(tag, canonical)
      }
    }
  }

  return mergeMap
}

/**
 * Extract semantic triples from justifications and deduplicate.
 */
export function extractSemanticTriples(
  justifications: JustificationDoc[]
): SemanticTriple[] {
  const seen = new Set<string>()
  const triples: SemanticTriple[] = []

  for (const j of justifications) {
    for (const triple of j.semantic_triples) {
      const key = `${triple.subject}|${triple.predicate}|${triple.object}`
      if (!seen.has(key)) {
        seen.add(key)
        triples.push(triple)
      }
    }
  }

  return triples
}

/** Minimum concept overlap to group two feature tags into the same area */
const AREA_OVERLAP_THRESHOLD = 2

/**
 * Cluster feature tags into higher-level feature areas based on shared domain_concepts.
 * Returns a map from feature_tag → feature_area (the canonical tag of the cluster).
 *
 * Example: "user_auth", "user_registration", "user_profile" might all cluster
 * into a "user_management" area if they share concepts like "user", "account".
 */
export function clusterFeatureAreas(
  justifications: JustificationDoc[]
): Map<string, string> {
  // Step 1: Collect domain concepts per feature tag
  const tagConcepts = new Map<string, Set<string>>()
  for (const j of justifications) {
    if (!tagConcepts.has(j.feature_tag)) tagConcepts.set(j.feature_tag, new Set())
    const concepts = tagConcepts.get(j.feature_tag)!
    for (const c of j.domain_concepts) {
      concepts.add(c.toLowerCase().trim())
    }
  }

  const tags = Array.from(tagConcepts.keys())
  if (tags.length <= 1) return new Map()

  // Step 2: Build adjacency by shared concept count
  const clusters: Set<string>[] = []
  const assigned = new Set<string>()

  for (const tag of tags) {
    if (assigned.has(tag)) continue
    const cluster = new Set<string>([tag])
    assigned.add(tag)
    const tagConceptSet = tagConcepts.get(tag)!

    for (const other of tags) {
      if (assigned.has(other)) continue
      const otherConcepts = tagConcepts.get(other)!

      // Count shared concepts
      let overlap = 0
      for (const c of Array.from(tagConceptSet)) {
        if (otherConcepts.has(c)) overlap++
      }

      if (overlap >= AREA_OVERLAP_THRESHOLD) {
        cluster.add(other)
        assigned.add(other)
      }
    }

    if (cluster.size > 1) {
      clusters.push(cluster)
    }
  }

  // Step 3: Build area map — canonical tag is the most frequent tag in cluster
  const tagFreq = new Map<string, number>()
  for (const j of justifications) {
    tagFreq.set(j.feature_tag, (tagFreq.get(j.feature_tag) ?? 0) + 1)
  }

  const areaMap = new Map<string, string>()
  for (const cluster of clusters) {
    let canonical = ""
    let maxFreq = 0
    for (const tag of Array.from(cluster)) {
      const f = tagFreq.get(tag) ?? 0
      if (f > maxFreq || (f === maxFreq && tag < canonical)) {
        canonical = tag
        maxFreq = f
      }
    }
    for (const tag of Array.from(cluster)) {
      if (tag !== canonical) {
        areaMap.set(tag, canonical)
      }
    }
  }

  return areaMap
}

/**
 * Deduplicate and aggregate features by feature_tag.
 */
export function deduplicateFeatures(
  justifications: JustificationDoc[],
  orgId: string,
  repoId: string
): FeatureAggregation[] {
  const byTag = new Map<string, JustificationDoc[]>()

  for (const j of justifications) {
    if (!byTag.has(j.feature_tag)) byTag.set(j.feature_tag, [])
    byTag.get(j.feature_tag)!.push(j)
  }

  const features: FeatureAggregation[] = []

  for (const [tag, docs] of Array.from(byTag.entries())) {
    const taxonomyBreakdown: Record<string, number> = {
      VERTICAL: 0,
      HORIZONTAL: 0,
      UTILITY: 0,
    }
    let totalConfidence = 0

    for (const d of docs) {
      taxonomyBreakdown[d.taxonomy] = (taxonomyBreakdown[d.taxonomy] ?? 0) + 1
      totalConfidence += d.confidence
    }

    features.push({
      id: `${repoId}_${tag}`,
      org_id: orgId,
      repo_id: repoId,
      feature_tag: tag,
      entity_count: docs.length,
      entry_points: [], // Populated by feature-aggregator
      hot_paths: [],
      taxonomy_breakdown: taxonomyBreakdown,
      average_confidence: docs.length > 0 ? totalConfidence / docs.length : 0,
      created_at: new Date().toISOString(),
    })
  }

  return features
}
