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

  // ── Reasoning field validation ──────────────────────────────────
  const reasoning = (justification as Record<string, unknown>).reasoning as string | undefined
  if (!reasoning || reasoning.length === 0) {
    score -= 0.15
    flags.push("missing_reasoning")
  } else {
    // Too short reasoning — should be 2-3 sentences with evidence
    if (reasoning.length < 80) {
      score -= 0.15
      flags.push("short_reasoning")
    }

    // Reasoning is just a copy of businessPurpose (no additional insight)
    const normalizedReasoning = reasoning.toLowerCase().trim()
    const normalizedPurpose = purpose.trim()
    if (normalizedReasoning === normalizedPurpose ||
        normalizedPurpose.length > 20 && normalizedReasoning.includes(normalizedPurpose)) {
      score -= 0.15
      flags.push("reasoning_copies_purpose")
    }

    // Reasoning should reference concrete code signals (not be abstract hand-waving)
    const CODE_SIGNAL_PATTERNS = [
      /\bnam(e|ing|ed)\b/i, /\bpattern\b/i, /\bsignat/i, /\bimport/i,
      /\bcall(s|ed|ing)?\b/i, /\breturn/i, /\bimplement/i, /\bextend/i,
      /\bfile\b/i, /\bmodule\b/i, /\bclass\b/i, /\bfunction\b/i,
      /\binterface\b/i, /\bmethod\b/i, /\bparam/i, /\basync\b/i,
      /\bdependen/i, /\binherit/i, /\bexport/i, /\btest/i,
    ]
    const hasCodeSignal = CODE_SIGNAL_PATTERNS.some((p) => p.test(reasoning))
    if (!hasCodeSignal) {
      score -= 0.1
      flags.push("reasoning_no_code_signals")
    }
  }

  // ── Confidence / Taxonomy alignment ─────────────────────────────
  // Low confidence on business-critical taxonomy = risky classification
  if (justification.confidence < 0.5 && justification.taxonomy === "VERTICAL") {
    score -= 0.15
    flags.push("low_confidence_vertical")
  }

  // Suspiciously high confidence with UTILITY + no domain concepts
  // (likely a misclassification — important code classified as UTILITY)
  if (justification.confidence >= 0.9 && justification.taxonomy === "UTILITY" &&
      justification.domain_concepts.length === 0) {
    score -= 0.1
    flags.push("high_confidence_utility_no_concepts")
  }

  // Too few domain concepts for VERTICAL entities (should have meaningful domain terms)
  if (justification.taxonomy === "VERTICAL" && justification.domain_concepts.length < 2) {
    score -= 0.1
    flags.push("vertical_few_concepts")
  }

  // ── Architectural pattern cross-check ───────────────────────────
  const archPattern = justification.architectural_pattern as string | undefined
  if (archPattern === "pure_domain" && justification.domain_concepts.length === 0) {
    score -= 0.1
    flags.push("pure_domain_no_concepts")
  }

  return {
    score: Math.max(0, Math.round(score * 100) / 100),
    flags,
  }
}
