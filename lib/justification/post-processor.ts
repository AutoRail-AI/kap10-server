/**
 * Phase 4: Post-Processor — normalizes justifications, deduplicates features,
 * extracts semantic triples, and adds bi-temporal metadata.
 */

import type { JustificationDoc, FeatureAggregation } from "@/lib/ports/types"
import type { SemanticTriple } from "./schemas"

/**
 * Normalize justifications: deduplicate feature tags, ensure consistent naming.
 */
export function normalizeJustifications(
  justifications: JustificationDoc[]
): JustificationDoc[] {
  // Normalize feature tags: lowercase, trim, replace spaces with underscores
  return justifications.map((j) => ({
    ...j,
    feature_tag: normalizeFeatureTag(j.feature_tag),
    domain_concepts: j.domain_concepts.map((c) => c.toLowerCase().trim()),
    compliance_tags: j.compliance_tags.map((t) => t.toUpperCase().trim()),
  }))
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
