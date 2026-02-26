/**
 * Phase 4: Model Router — multi-tier routing for justification LLM calls.
 *
 * All entities go to LLM — heuristics provide hints, not skip signals.
 * Tier 1 (fast):      Small/fast model for straightforward entities.
 * Tier 2 (standard):  Default model for most entities.
 * Tier 3 (premium):   Premium model for high-centrality, complex entities.
 *
 * Safety patterns route to premium tier.
 */

import { LLM_MODELS } from "@/lib/llm/config"
import type { EntityDoc } from "@/lib/ports/types"
import type { ModelRoute, ModelTier, Taxonomy } from "./schemas"
import type { HeuristicResult } from "./types"

const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /\.stories\.[jt]sx?$/,
]

const CONFIG_FILE_PATTERNS = [
  /\.config\.[jt]sx?$/,
  /\.config\.(json|ya?ml|toml)$/,
  /tsconfig.*\.json$/,
  /package\.json$/,
  /\.eslintrc/,
  /\.prettierrc/,
  /webpack\./,
  /vite\./,
  /rollup\./,
  /jest\./,
  /vitest\./,
]

const TYPE_ONLY_KINDS = ["type", "interface", "enum"]

/**
 * Safety patterns — entities matching these MUST go to LLM, never be classified as trivial.
 * This prevents critical security/auth code from being silently skipped.
 */
const SAFETY_PATTERNS = [
  /auth/i, /security/i, /validate/i, /verify/i,
  /credential/i, /password/i, /token/i, /permission/i,
  /encrypt/i, /decrypt/i, /sanitize/i, /csrf/i, /xss/i,
]

/** Standard accessor method names that are always UTILITY. */
const STANDARD_ACCESSORS = new Set([
  "tostring", "valueof", "tojson", "clone", "equals",
  "hashcode", "compareto", "toarray", "tolist", "tomap",
])

/**
 * Check if an entity name matches safety patterns — these MUST go to LLM.
 */
function isSafetyRelevant(name: string, filePath: string): boolean {
  return SAFETY_PATTERNS.some((p) => p.test(name) || p.test(filePath))
}

/**
 * Get the line count of an entity from its body or start_line/end_line.
 */
function getEntityLineCount(entity: EntityDoc): number | null {
  const body = entity.body as string | undefined
  if (body) return body.split("\n").length
  const startLine = entity.start_line as number | undefined
  const endLine = entity.end_line as number | undefined
  if (startLine != null && endLine != null) return endLine - startLine + 1
  return null
}

/** @deprecated Use computeHeuristicHint instead */
export function applyHeuristics(entity: EntityDoc): HeuristicResult | null {
  return computeHeuristicHint(entity)
}

/** Type for heuristic hints passed as context to LLM prompts */
export type HeuristicHint = { taxonomy: string; featureTag: string; reason: string } | null

/**
 * Compute a heuristic hint for an entity based on static analysis.
 * Returns a hint object with suggested taxonomy/featureTag, or null if no pattern matches.
 * The hint is passed as context to the LLM — it does NOT skip LLM classification.
 *
 * Order of checks:
 * 1. Safety rules (return null — no hint, let LLM classify freely)
 * 2. File-level heuristics (test files, config files, barrel files)
 * 3. Entity-level heuristics (getters, setters, constructors, DTOs, etc.)
 */
export function computeHeuristicHint(entity: EntityDoc): HeuristicResult | null {
  const filePath = entity.file_path ?? ""
  const kind = entity.kind ?? ""
  const name = entity.name ?? ""
  const nameLower = name.toLowerCase()

  // ── Safety rules: NEVER skip these, always send to LLM ──
  if (isSafetyRelevant(name, filePath)) {
    return null
  }

  // ── File-level heuristics ──

  // Test files → UTILITY
  if (TEST_FILE_PATTERNS.some((p) => p.test(filePath))) {
    return {
      taxonomy: "UTILITY" as Taxonomy,
      confidence: 0.95,
      businessPurpose: "Test infrastructure — validates correctness of production code",
      featureTag: "testing",
      reason: "test file pattern match",
    }
  }

  // Config files → HORIZONTAL
  if (CONFIG_FILE_PATTERNS.some((p) => p.test(filePath))) {
    return {
      taxonomy: "HORIZONTAL" as Taxonomy,
      confidence: 0.9,
      businessPurpose: "Build/tooling configuration — shared infrastructure concern",
      featureTag: "configuration",
      reason: "config file pattern match",
    }
  }

  // .d.ts declaration files → UTILITY
  if (filePath.endsWith(".d.ts")) {
    return {
      taxonomy: "UTILITY" as Taxonomy,
      confidence: 0.90,
      businessPurpose: "Type declaration file — provides type information for external modules",
      featureTag: "type-system",
      reason: ".d.ts declaration file",
    }
  }

  // Index/barrel files → HORIZONTAL
  if (/^index\.[jt]sx?$/.test(name) || filePath.endsWith("/index.ts") || filePath.endsWith("/index.js")) {
    if (kind === "file") {
      return {
        taxonomy: "HORIZONTAL" as Taxonomy,
        confidence: 0.85,
        businessPurpose: "Module re-export barrel — organizes public API surface",
        featureTag: "module-structure",
        reason: "index/barrel file",
      }
    }
  }

  // ── Entity-level heuristics ──

  const lineCount = getEntityLineCount(entity)

  // Function/method-level heuristics
  if (kind === "function" || kind === "method") {
    // Simple getters: get*/is*/has* + ≤3 lines
    if (/^(get|is|has)[A-Z]/.test(name) && lineCount != null && lineCount <= 3) {
      return {
        taxonomy: "UTILITY" as Taxonomy,
        confidence: 0.90,
        businessPurpose: "Simple accessor — provides read access to internal state",
        featureTag: "data-access",
        reason: "simple getter (≤3 lines)",
      }
    }

    // Simple setters: set* + ≤3 lines
    if (/^set[A-Z]/.test(name) && lineCount != null && lineCount <= 3) {
      return {
        taxonomy: "UTILITY" as Taxonomy,
        confidence: 0.90,
        businessPurpose: "Simple mutator — provides write access to internal state",
        featureTag: "data-access",
        reason: "simple setter (≤3 lines)",
      }
    }

    // Standard accessor methods (toString, valueOf, etc.)
    if (STANDARD_ACCESSORS.has(nameLower)) {
      return {
        taxonomy: "UTILITY" as Taxonomy,
        confidence: 0.90,
        businessPurpose: "Standard accessor — implements a well-known conversion/comparison protocol",
        featureTag: "data-access",
        reason: "standard accessor method",
      }
    }

    // Constructors with ≤5 lines
    if (nameLower === "constructor" && lineCount != null && lineCount <= 5) {
      return {
        taxonomy: "UTILITY" as Taxonomy,
        confidence: 0.85,
        businessPurpose: "Simple constructor — initializes instance with provided values",
        featureTag: "initialization",
        reason: "simple constructor (≤5 lines)",
      }
    }

    // Minimal complexity functions (complexity=1 + ≤5 lines = likely trivial wrapper)
    const entityComplexity = entity.complexity as number | undefined
    if (entityComplexity === 1 && lineCount != null && lineCount <= 5) {
      return {
        taxonomy: "UTILITY" as Taxonomy,
        confidence: 0.80,
        businessPurpose: "Simple wrapper or delegation — minimal logic with no branching",
        featureTag: "utility",
        reason: "minimal complexity (1) with ≤5 lines",
      }
    }

    // Noop/identity functions
    if (/^(noop|identity|_+)$/.test(name)) {
      return {
        taxonomy: "UTILITY" as Taxonomy,
        confidence: 0.95,
        businessPurpose: "Noop/identity function — placeholder or default callback",
        featureTag: "utility",
        reason: "noop/identity function",
      }
    }
  }

  // Class-level heuristics
  if (kind === "class" || kind === "struct") {
    // Error classes
    if (/(?:Error|Exception)$/.test(name)) {
      return {
        taxonomy: "UTILITY" as Taxonomy,
        confidence: 0.90,
        businessPurpose: "Error class — defines a specific error type for structured error handling",
        featureTag: "error-handling",
        reason: "error/exception class",
      }
    }

    // Data classes (DTO, Model, Entity, Record, State) with ≤10 lines
    if (/(?:DTO|Dto|Model|Entity|Record|State)$/.test(name) && lineCount != null && lineCount <= 10) {
      return {
        taxonomy: "UTILITY" as Taxonomy,
        confidence: 0.85,
        businessPurpose: "Data transfer object — carries structured data between layers",
        featureTag: "data-model",
        reason: "data class (≤10 lines)",
      }
    }
  }

  // Type-only entities → UTILITY (interfaces, type aliases, enums)
  if (TYPE_ONLY_KINDS.includes(kind)) {
    // Config/Props interfaces get a more specific classification
    if (kind === "interface" && /(?:Props|Options|Config|Settings|Params|Args)$/.test(name)) {
      return {
        taxonomy: "UTILITY" as Taxonomy,
        confidence: 0.90,
        businessPurpose: "Configuration interface — defines shape of options/parameters for a component or function",
        featureTag: "configuration",
        reason: "config/props interface",
      }
    }

    return {
      taxonomy: "UTILITY" as Taxonomy,
      confidence: 0.85,
      businessPurpose: "Type definition — provides type safety across the codebase",
      featureTag: "type-system",
      reason: "type-only entity kind",
    }
  }

  return null
}

/**
 * Route an entity to the appropriate model tier.
 * All entities go to LLM — no heuristic short-circuit.
 * Takes optional centrality score for premium routing.
 */
export function routeModel(
  entity: EntityDoc,
  opts?: { centrality?: number; hasComplexDependencies?: boolean; callerCount?: number }
): ModelRoute {
  // Safety patterns always go to premium
  const filePath = entity.file_path ?? ""
  const name = entity.name ?? ""
  if (isSafetyRelevant(name, filePath)) {
    return {
      tier: "premium" as ModelTier,
      model: LLM_MODELS.premium,
      reason: "safety-relevant entity (auth/security)",
    }
  }

  // Premium tier: high centrality, complex dependency graphs, high callerCount, or high cyclomatic complexity
  const entityComplexity = entity.complexity as number | undefined
  const callerCount = opts?.callerCount
  if (
    (opts?.centrality ?? 0) > 0.8 ||
    opts?.hasComplexDependencies ||
    (entityComplexity != null && entityComplexity >= 10) ||
    (callerCount != null && callerCount >= 8)
  ) {
    return {
      tier: "premium" as ModelTier,
      model: LLM_MODELS.premium,
      reason: callerCount != null && callerCount >= 8
        ? `high caller count (${callerCount} callers)`
        : entityComplexity != null && entityComplexity >= 10
          ? `high cyclomatic complexity (${entityComplexity})`
          : "high centrality or complex dependencies",
    }
  }

  // Fast tier: simple entities (variables, standalone functions with zero callers)
  const kind = entity.kind ?? ""
  if (["variable", "constant"].includes(kind)) {
    return {
      tier: "fast" as ModelTier,
      model: LLM_MODELS.fast,
      reason: "simple entity kind",
    }
  }

  // Standard tier: everything else
  return {
    tier: "standard" as ModelTier,
    model: LLM_MODELS.standard,
    reason: "default routing",
  }
}
