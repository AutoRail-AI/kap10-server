/**
 * Justification quality scoring — heuristic checks on LLM output.
 *
 * Flags generic phrases, too-short purposes, programming terms as domain concepts,
 * and other quality issues. Scores are stored as metadata on justifications for diagnostics.
 */

import type { JustificationDoc } from "@/lib/ports/types"

export interface QualityScore {
  /** Quality score from 0.0 (terrible) to 1.0 (excellent) */
  score: number
  /** Human-readable flags explaining score deductions */
  flags: string[]
}

const GENERIC_PHRASES = [
  "handles operations",
  "manages data",
  "performs operations",
  "handles processing",
  "manages the",
  "provides functionality",
  "utility function",
  "helper function",
  "does various",
  "general purpose",
  "handles various",
]

const PROGRAMMING_TERMS = new Set([
  "function", "class", "string", "number", "boolean", "object", "array",
  "variable", "parameter", "argument", "return", "void", "null", "undefined",
  "interface", "type", "method", "property", "constructor", "instance",
  "module", "import", "export", "async", "await", "promise", "callback",
])

/**
 * Score the quality of a justification result.
 * Returns a score (0-1) and a list of quality flags.
 */
export function scoreJustification(justification: JustificationDoc): QualityScore {
  let score = 1.0
  const flags: string[] = []
  const purpose = justification.business_purpose.toLowerCase()

  // Check for generic phrases
  for (const phrase of GENERIC_PHRASES) {
    if (purpose.includes(phrase)) {
      score -= 0.3
      flags.push(`generic_phrase: "${phrase}"`)
      break // Only penalize once for generic phrases
    }
  }

  // Too short businessPurpose
  if (justification.business_purpose.length < 30) {
    score -= 0.2
    flags.push("short_purpose")
  }

  // High confidence but no domain concepts
  if (justification.confidence >= 0.8 && justification.domain_concepts.length === 0) {
    score -= 0.2
    flags.push("high_confidence_no_concepts")
  }

  // Programming terms as domain concepts
  const progTermCount = justification.domain_concepts.filter(
    (c) => PROGRAMMING_TERMS.has(c.toLowerCase())
  ).length
  if (progTermCount > 0) {
    score -= Math.min(0.15 * progTermCount, 0.3)
    flags.push(`programming_terms_as_concepts: ${progTermCount}`)
  }

  // Generic feature tags
  if (justification.feature_tag === "utility" || justification.feature_tag === "misc" || justification.feature_tag === "other") {
    score -= 0.1
    flags.push("generic_feature_tag")
  }

  // Purpose starts with "A function" or "A class" (lazy phrasing)
  if (/^(a |the |this )(function|class|method|interface|type|variable)/i.test(justification.business_purpose)) {
    score -= 0.15
    flags.push("lazy_phrasing")
  }

  // Fallback justification detection
  if (purpose.includes("classification failed")) {
    score = 0.0
    flags.push("fallback_justification")
  }

  return {
    score: Math.max(0, Math.round(score * 100) / 100),
    flags,
  }
}
