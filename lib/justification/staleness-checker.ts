/**
 * Content-hash staleness detection for justification pipeline.
 *
 * Compares entity body hashes against stored justification body_hash values
 * to skip unchanged entities during re-justification. Reduces LLM calls
 * by 60-80% on re-indexing when most entities haven't changed.
 *
 * Also includes:
 * - Quality-based invalidation: low-quality justifications are always re-justified
 * - L-09: Change-type aware cascading (signature/anchors/body/comments classification)
 * - Fallback TTL: re-justify entities older than 30 days regardless of body hash
 */

import { createHash } from "node:crypto"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"
import { classifyChange, shouldCascadeChange } from "./change-classifier"

/** Minimum quality score below which an entity is always re-justified */
const QUALITY_RE_JUSTIFY_THRESHOLD = 0.4

/** L-09: Max age in days before a justification is considered stale regardless of body hash */
const MAX_JUSTIFICATION_AGE_DAYS = 30

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
  /** L-09: Reasons why each stale entity was marked stale (entity_id → reason) */
  staleReasons: Map<string, string>
}

/**
 * Check which entities need re-justification based on content hashes,
 * quality scores, and L-09 change-type aware cascading.
 *
 * An entity is considered **stale** (needs re-justification) if ANY of:
 * 1. No existing justification exists
 * 2. Body hash changed (code was modified)
 * 3. Quality score is below threshold (previous justification was poor)
 * 4. L-09: A callee's change type warrants cascade (signature/anchor/body changes)
 * 5. L-09: Justification age exceeds 30-day TTL (captures ontology drift)
 *
 * @param entities - Entities to check
 * @param existingJustifications - Map of entity_id → current JustificationDoc
 * @param calleeChangedSet - Set of entity IDs that were re-justified in this run
 * @param edges - All edges for the repo (used to check callee relationships)
 * @param previousJustifications - Map of entity_id → previous JustificationDoc (before this run's changes) for semantic comparison
 * @param currentEntityMap - L-09: Map of entity_id → current entity version (for change classification)
 * @param previousEntityMap - L-09: Map of entity_id → previous entity version (for change classification)
 */
export function checkStaleness(
  entities: EntityDoc[],
  existingJustifications: Map<string, JustificationDoc>,
  calleeChangedSet: Set<string>,
  edges?: Array<{ _from: string; _to: string; kind: string }>,
  previousJustifications?: Map<string, JustificationDoc>,
  currentEntityMap?: Map<string, EntityDoc>,
  previousEntityMap?: Map<string, EntityDoc>,
): StalenessResult {
  const stale: EntityDoc[] = []
  const fresh: EntityDoc[] = []
  const staleReasons = new Map<string, string>()

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

  const now = Date.now()
  const maxAgeMs = MAX_JUSTIFICATION_AGE_DAYS * 24 * 60 * 60 * 1000

  for (const entity of entities) {
    const existing = existingJustifications.get(entity.id)

    // No existing justification → stale
    if (!existing) {
      stale.push(entity)
      staleReasons.set(entity.id, "No existing justification")
      continue
    }

    // Check body hash
    const currentHash = computeBodyHash(entity)
    const storedHash = existing.body_hash as string | undefined

    if (!storedHash || storedHash !== currentHash) {
      stale.push(entity)
      staleReasons.set(entity.id, "Body hash changed")
      continue
    }

    // Quality-based invalidation: low-quality or fallback justifications always re-justified
    const qualityScore = (existing as Record<string, unknown>).quality_score as number | undefined
    const qualityFlags = (existing as Record<string, unknown>).quality_flags as string[] | undefined
    if (qualityScore != null && qualityScore < QUALITY_RE_JUSTIFY_THRESHOLD) {
      stale.push(entity)
      staleReasons.set(entity.id, `Low quality score: ${qualityScore.toFixed(2)}`)
      continue
    }
    if (qualityFlags && qualityFlags.includes("fallback_justification")) {
      stale.push(entity)
      staleReasons.set(entity.id, "Fallback justification")
      continue
    }

    // L-09: Age-based TTL — re-justify if older than 30 days
    const createdAt = existing.created_at
    if (createdAt) {
      const age = now - new Date(createdAt).getTime()
      if (age > maxAgeMs) {
        stale.push(entity)
        staleReasons.set(entity.id, `Justification age ${Math.round(age / 86400000)}d exceeds ${MAX_JUSTIFICATION_AGE_DAYS}d TTL`)
        continue
      }
    }

    // L-09: Change-type aware cascading
    const callees = outboundCallees.get(entity.id)
    if (callees && calleeChangedSet.size > 0) {
      let cascadeReason: string | null = null
      for (const calleeId of Array.from(callees)) {
        if (!calleeChangedSet.has(calleeId)) continue

        // L-09: Use change-type classification if entity maps are available
        const oldCalleeEntity = previousEntityMap?.get(calleeId)
        const newCalleeEntity = currentEntityMap?.get(calleeId)

        if (oldCalleeEntity && newCalleeEntity) {
          const classification = classifyChange(oldCalleeEntity, newCalleeEntity)
          const { cascade, reason } = shouldCascadeChange(classification)
          if (cascade) {
            cascadeReason = `Callee ${calleeId}: ${reason}`
            break
          }
        } else {
          // Fallback to Jaccard similarity when entity maps not available
          const currentCallee = existingJustifications.get(calleeId)
          const previousCallee = previousJustifications?.get(calleeId)

          if (currentCallee && previousCallee) {
            const currentKeywords = extractSemanticKeywords(currentCallee)
            const previousKeywords = extractSemanticKeywords(previousCallee)
            const similarity = jaccardSimilarity(currentKeywords, previousKeywords)
            if (similarity < 0.75) {
              cascadeReason = `Callee ${calleeId}: Jaccard similarity ${(similarity * 100).toFixed(0)}% below threshold`
              break
            }
          } else {
            cascadeReason = `Callee ${calleeId}: no previous version — conservative cascade`
            break
          }
        }
      }
      if (cascadeReason) {
        stale.push(entity)
        staleReasons.set(entity.id, cascadeReason)
        continue
      }
    }

    // All checks passed — this entity is fresh
    fresh.push(entity)
  }

  return { stale, fresh, staleReasons }
}
