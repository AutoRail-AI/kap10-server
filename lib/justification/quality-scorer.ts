/**
 * Justification quality scoring — heuristic checks on LLM output.
 *
 * L-11: Balanced scoring with both penalty and positive reinforcement signals.
 * Baseline is 0.5 (neutral). Penalties push below, positive signals push above.
 * Final score is clamped to [0, 1].
 *
 * Penalty signals: generic phrases, short purposes, programming terms as concepts, etc.
 * Positive signals: domain terminology, concrete entity references, rich semantic triples,
 * specific feature tags, well-structured reasoning with evidence.
 */

import type { JustificationDoc } from "@/lib/ports/types"

export interface QualityScore {
  /** Quality score from 0.0 (terrible) to 1.0 (excellent). 0.5 = neutral baseline. */
  score: number
  /** Human-readable flags explaining score adjustments (prefixed +/- for direction) */
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

/** Generic feature tags that indicate lack of domain specificity. */
const GENERIC_FEATURE_TAGS = new Set(["utility", "misc", "other", "general", "unknown"])

/**
 * Domain-specific terminology patterns that indicate substantive business understanding.
 * Each pattern targets a distinct domain vocabulary cluster.
 */
const DOMAIN_TERM_PATTERNS = [
  /\b(auth|authenticat|authoriz|session|credential|login|signup|oauth|sso|rbac|permission)\b/i,
  /\b(payment|billing|invoice|subscription|checkout|refund|pricing|revenue|charge)\b/i,
  /\b(order|cart|shipment|inventory|catalog|warehouse|fulfillment|sku)\b/i,
  /\b(patient|diagnosis|prescription|clinical|medical|health|treatment|pharmacy)\b/i,
  /\b(workflow|pipeline|orchestrat|queue|job|scheduler|dispatch|routing)\b/i,
  /\b(notification|alert|email|webhook|event|publish|subscribe|broadcast)\b/i,
  /\b(cache|index|search|query|filter|aggregat|pagination|shard|replica)\b/i,
  /\b(encrypt|decrypt|hash|sign|verify|certificate|tls|ssl|vault|secret)\b/i,
  /\b(deploy|ci\/cd|migration|rollback|release|canary|feature.?flag|toggle)\b/i,
  /\b(compliance|audit|gdpr|hipaa|pci|regulation|retention|consent)\b/i,
  /\b(analytics|metrics|telemetry|tracing|logging|monitoring|dashboard|report)\b/i,
  /\b(tenant|organization|workspace|team|role|policy|access.?control)\b/i,
]

/**
 * Score the quality of a justification result.
 *
 * L-11: Balanced scoring — baseline 0.5, penalties deduct, positive signals add.
 * Returns a score [0, 1] and a list of quality flags.
 */
export function scoreJustification(justification: JustificationDoc): QualityScore {
  const BASELINE = 0.5
  let penalty = 0
  let bonus = 0
  const flags: string[] = []
  const purpose = justification.business_purpose.toLowerCase()

  // ── PENALTY SIGNALS ─────────────────────────────────────────────

  // Check for generic phrases
  for (const phrase of GENERIC_PHRASES) {
    if (purpose.includes(phrase)) {
      penalty += 0.15
      flags.push(`-generic_phrase: "${phrase}"`)
      break // Only penalize once for generic phrases
    }
  }

  // Too short businessPurpose
  if (justification.business_purpose.length < 30) {
    penalty += 0.1
    flags.push("-short_purpose")
  }

  // High confidence but no domain concepts
  if (justification.confidence >= 0.8 && justification.domain_concepts.length === 0) {
    penalty += 0.1
    flags.push("-high_confidence_no_concepts")
  }

  // Programming terms as domain concepts
  const progTermCount = justification.domain_concepts.filter(
    (c) => PROGRAMMING_TERMS.has(c.toLowerCase())
  ).length
  if (progTermCount > 0) {
    penalty += Math.min(0.08 * progTermCount, 0.15)
    flags.push(`-programming_terms_as_concepts: ${progTermCount}`)
  }

  // Generic feature tags
  if (GENERIC_FEATURE_TAGS.has(justification.feature_tag)) {
    penalty += 0.05
    flags.push("-generic_feature_tag")
  }

  // Purpose starts with "A function" or "A class" (lazy phrasing)
  if (/^(a |the |this )(function|class|method|interface|type|variable)/i.test(justification.business_purpose)) {
    penalty += 0.08
    flags.push("-lazy_phrasing")
  }

  // Fallback justification detection
  if (purpose.includes("classification failed")) {
    penalty = BASELINE // Drive score to 0
    flags.push("-fallback_justification")
  }

  // ── Reasoning field validation ──────────────────────────────────
  const reasoning = (justification as Record<string, unknown>).reasoning as string | undefined
  if (!reasoning || reasoning.length === 0) {
    penalty += 0.08
    flags.push("-missing_reasoning")
  } else {
    // Too short reasoning — should be 2-3 sentences with evidence
    if (reasoning.length < 80) {
      penalty += 0.08
      flags.push("-short_reasoning")
    }

    // Reasoning is just a copy of businessPurpose (no additional insight)
    const normalizedReasoning = reasoning.toLowerCase().trim()
    const normalizedPurpose = purpose.trim()
    if (normalizedReasoning === normalizedPurpose ||
        normalizedPurpose.length > 20 && normalizedReasoning.includes(normalizedPurpose)) {
      penalty += 0.08
      flags.push("-reasoning_copies_purpose")
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
      penalty += 0.05
      flags.push("-reasoning_no_code_signals")
    }
  }

  // ── Confidence / Taxonomy alignment ─────────────────────────────
  if (justification.confidence < 0.5 && justification.taxonomy === "VERTICAL") {
    penalty += 0.08
    flags.push("-low_confidence_vertical")
  }

  if (justification.confidence >= 0.9 && justification.taxonomy === "UTILITY" &&
      justification.domain_concepts.length === 0) {
    penalty += 0.05
    flags.push("-high_confidence_utility_no_concepts")
  }

  if (justification.taxonomy === "VERTICAL" && justification.domain_concepts.length < 2) {
    penalty += 0.05
    flags.push("-vertical_few_concepts")
  }

  // ── Architectural pattern cross-check ───────────────────────────
  const archPattern = justification.architectural_pattern as string | undefined
  if (archPattern === "pure_domain" && justification.domain_concepts.length === 0) {
    penalty += 0.05
    flags.push("-pure_domain_no_concepts")
  }

  // ── POSITIVE REINFORCEMENT SIGNALS ──────────────────────────────

  // Rich domain concepts (non-programming terms)
  const realDomainConcepts = justification.domain_concepts.filter(
    (c) => !PROGRAMMING_TERMS.has(c.toLowerCase())
  )
  if (realDomainConcepts.length >= 3) {
    bonus += 0.1
    flags.push(`+rich_domain_concepts: ${realDomainConcepts.length}`)
  } else if (realDomainConcepts.length >= 1) {
    bonus += 0.05
    flags.push(`+has_domain_concepts: ${realDomainConcepts.length}`)
  }

  // Domain-specific terminology in business purpose
  const domainMatches = DOMAIN_TERM_PATTERNS.filter((p) => p.test(purpose)).length
  if (domainMatches >= 2) {
    bonus += 0.1
    flags.push(`+domain_terminology: ${domainMatches} clusters`)
  } else if (domainMatches === 1) {
    bonus += 0.05
    flags.push("+domain_terminology: 1 cluster")
  }

  // Specific (non-generic) feature tag
  if (justification.feature_tag && !GENERIC_FEATURE_TAGS.has(justification.feature_tag) &&
      justification.feature_tag.length > 2) {
    bonus += 0.05
    flags.push("+specific_feature_tag")
  }

  // Well-formed semantic triples (subject-predicate-object with real content)
  const meaningfulTriples = justification.semantic_triples.filter(
    (t) => t.subject.length > 2 && t.predicate.length > 2 && t.object.length > 2
  )
  if (meaningfulTriples.length >= 3) {
    bonus += 0.1
    flags.push(`+rich_semantic_triples: ${meaningfulTriples.length}`)
  } else if (meaningfulTriples.length >= 1) {
    bonus += 0.05
    flags.push(`+has_semantic_triples: ${meaningfulTriples.length}`)
  }

  // Substantive business purpose (long enough with concrete entity/action references)
  if (justification.business_purpose.length >= 80) {
    bonus += 0.05
    flags.push("+detailed_purpose")
  }

  // Reasoning with concrete evidence (entity names, file paths, specific patterns)
  if (reasoning && reasoning.length >= 120) {
    const EVIDENCE_PATTERNS = [
      /[A-Z][a-z]+[A-Z]/,      // CamelCase entity names
      /\b\w+\.\w+\.\w+/,       // dotted paths (e.g., module.class.method)
      /\b\w+_\w+\b/,           // snake_case identifiers
      /`[^`]+`/,                // backtick-quoted references
      /\b\d+\s*(call|import|depend|reference|usage)/i, // quantified evidence
    ]
    const evidenceCount = EVIDENCE_PATTERNS.filter((p) => p.test(reasoning)).length
    if (evidenceCount >= 2) {
      bonus += 0.1
      flags.push(`+evidence_rich_reasoning: ${evidenceCount} signals`)
    } else if (evidenceCount >= 1) {
      bonus += 0.05
      flags.push("+evidence_in_reasoning")
    }
  }

  // Compliance tags present (indicates regulatory/policy awareness)
  if (justification.compliance_tags.length > 0) {
    bonus += 0.05
    flags.push(`+compliance_awareness: ${justification.compliance_tags.length}`)
  }

  // Architectural pattern specified (indicates structural understanding)
  if (archPattern && archPattern !== "unknown" && archPattern !== "other") {
    bonus += 0.05
    flags.push("+architectural_pattern")
  }

  // ── COMPUTE FINAL SCORE ─────────────────────────────────────────
  const score = BASELINE - penalty + bonus

  return {
    score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
    flags,
  }
}
