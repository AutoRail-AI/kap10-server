/**
 * Content-hash staleness detection for justification pipeline.
 *
 * Compares entity body hashes against stored justification body_hash values
 * to skip unchanged entities during re-justification. Reduces LLM calls
 * by 60-80% on re-indexing when most entities haven't changed.
 *
 * Also includes:
 * - Quality-based invalidation: low-quality justifications are always re-justified
 * - Semantic cascading: only cascade if callee's justification meaningfully changed
 */

import { createHash } from "node:crypto"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"

/** Minimum quality score below which an entity is always re-justified */
const QUALITY_RE_JUSTIFY_THRESHOLD = 0.4

/** Jaccard similarity above which a callee change is considered cosmetic (no cascade needed) */
const SEMANTIC_SIMILARITY_THRESHOLD = 0.75

/**
 * Compute a stable hash of an entity's body content.
 * Used to detect whether an entity's code has changed since its last justification.
 */
export function computeBodyHash(entity: EntityDoc): string {
  const body = (entity.body as string) ?? ""
  const signature = (entity.signature as string) ?? ""
  // Include signature + body so that signature-only changes are also detected
  return createHash("sha256").update(`${signature}\n${body}`).digest("hex").slice(0, 16)
}

/**
 * Extract normalized semantic keywords from a justification for similarity comparison.
 * Strips stop words and normalizes to produce a meaningful keyword set that captures
 * the *intent* of the justification, not surface-level phrasing.
 */
export function extractSemanticKeywords(justification: JustificationDoc): Set<string> {
  const keywords = new Set<string>()

  // Taxonomy is a core signal
  keywords.add(justification.taxonomy.toLowerCase())

  // Feature tag (already normalized)
  if (justification.feature_tag && justification.feature_tag !== "unclassified") {
    keywords.add(justification.feature_tag)
  }

  // Domain concepts are high-signal semantic tokens
  for (const concept of justification.domain_concepts) {
    keywords.add(concept.toLowerCase().trim())
  }

  // Extract meaningful words from business_purpose (skip stop words)
  const purposeWords = justification.business_purpose
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  for (const word of purposeWords) {
    keywords.add(word)
  }

  // Architectural pattern
  const archPattern = (justification as Record<string, unknown>).architectural_pattern as string | undefined
  if (archPattern && archPattern !== "unknown") {
    keywords.add(archPattern)
  }

  return keywords
}

/**
 * Compute Jaccard similarity between two keyword sets.
 * Returns 1.0 for identical sets, 0.0 for disjoint sets.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0
  let intersection = 0
  for (const item of Array.from(a)) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 1.0 : intersection / union
}

/** Common English stop words filtered out of purpose text for semantic comparison */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "can", "shall", "this",
  "that", "these", "those", "it", "its", "not", "no", "nor", "all",
  "each", "every", "both", "few", "more", "most", "other", "some",
  "such", "than", "too", "very", "just", "also", "into", "over",
  "after", "before", "between", "through", "during", "about", "which",
  "when", "where", "who", "whom", "how", "what", "why", "then",
])

export interface StalenessResult {
  /** Entities that need re-justification (changed body or cascading invalidation) */
  stale: EntityDoc[]
  /** Entities whose existing justifications are still valid */
  fresh: EntityDoc[]
}

/**
 * Check which entities need re-justification based on content hashes,
 * quality scores, and semantic cascading.
 *
 * An entity is considered **stale** (needs re-justification) if ANY of:
 * 1. No existing justification exists
 * 2. Body hash changed (code was modified)
 * 3. Quality score is below threshold (previous justification was poor)
 * 4. A callee's justification *semantically* changed (not just rephrased)
 *
 * @param entities - Entities to check
 * @param existingJustifications - Map of entity_id → current JustificationDoc
 * @param calleeChangedSet - Set of entity IDs that were re-justified in this run
 * @param edges - All edges for the repo (used to check callee relationships)
 * @param previousJustifications - Map of entity_id → previous JustificationDoc (before this run's changes) for semantic comparison
 */
export function checkStaleness(
  entities: EntityDoc[],
  existingJustifications: Map<string, JustificationDoc>,
  calleeChangedSet: Set<string>,
  edges?: Array<{ _from: string; _to: string; kind: string }>,
  previousJustifications?: Map<string, JustificationDoc>
): StalenessResult {
  const stale: EntityDoc[] = []
  const fresh: EntityDoc[] = []

  // Build a quick lookup of outbound call edges per entity
  const outboundCallees = new Map<string, Set<string>>()
  if (edges) {
    for (const edge of edges) {
      if (edge.kind !== "calls") continue
      const fromId = edge._from.split("/").pop()!
      const toId = edge._to.split("/").pop()!
      let set = outboundCallees.get(fromId)
      if (!set) {
        set = new Set()
        outboundCallees.set(fromId, set)
      }
      set.add(toId)
    }
  }

  for (const entity of entities) {
    const existing = existingJustifications.get(entity.id)

    // No existing justification → stale
    if (!existing) {
      stale.push(entity)
      continue
    }

    // Check body hash
    const currentHash = computeBodyHash(entity)
    const storedHash = existing.body_hash as string | undefined

    if (!storedHash || storedHash !== currentHash) {
      stale.push(entity)
      continue
    }

    // Quality-based invalidation: low-quality or fallback justifications always re-justified
    const qualityScore = (existing as Record<string, unknown>).quality_score as number | undefined
    const qualityFlags = (existing as Record<string, unknown>).quality_flags as string[] | undefined
    if (qualityScore != null && qualityScore < QUALITY_RE_JUSTIFY_THRESHOLD) {
      stale.push(entity)
      continue
    }
    if (qualityFlags && qualityFlags.includes("fallback_justification")) {
      stale.push(entity)
      continue
    }

    // Semantic cascading: if a callee was re-justified, check whether its meaning actually changed
    const callees = outboundCallees.get(entity.id)
    if (callees && calleeChangedSet.size > 0) {
      let hasSemanticChange = false
      for (const calleeId of Array.from(callees)) {
        if (!calleeChangedSet.has(calleeId)) continue

        // If we have previous justifications to compare, check semantic similarity
        const currentCallee = existingJustifications.get(calleeId)
        const previousCallee = previousJustifications?.get(calleeId)

        if (currentCallee && previousCallee) {
          // Compare semantic keywords — only cascade if meaning actually changed
          const currentKeywords = extractSemanticKeywords(currentCallee)
          const previousKeywords = extractSemanticKeywords(previousCallee)
          const similarity = jaccardSimilarity(currentKeywords, previousKeywords)

          if (similarity < SEMANTIC_SIMILARITY_THRESHOLD) {
            hasSemanticChange = true
            break
          }
          // Similarity >= threshold → cosmetic change only, no cascade needed
        } else {
          // No previous justification to compare → conservative: cascade
          hasSemanticChange = true
          break
        }
      }
      if (hasSemanticChange) {
        stale.push(entity)
        continue
      }
    }

    // All checks passed — this entity is fresh
    fresh.push(entity)
  }

  return { stale, fresh }
}
