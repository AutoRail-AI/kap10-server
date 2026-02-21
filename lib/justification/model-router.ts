/**
 * Phase 4: Model Router — multi-tier routing for justification LLM calls.
 *
 * Tier 1 (heuristic): Skip LLM entirely for obvious cases (~40% of entities).
 * Tier 2 (fast):      Small/fast model for straightforward entities.
 * Tier 3 (standard):  Default model for most entities.
 * Tier 4 (premium):   Premium model for high-centrality, complex entities.
 *
 * Estimated cost savings: ~60% vs sending everything to premium.
 */

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
 * Apply heuristics to skip LLM for obvious classifications.
 * Returns null if LLM is needed.
 */
export function applyHeuristics(entity: EntityDoc): HeuristicResult | null {
  const filePath = entity.file_path ?? ""
  const kind = entity.kind ?? ""
  const name = entity.name ?? ""

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

  // Type-only entities → UTILITY
  if (TYPE_ONLY_KINDS.includes(kind)) {
    return {
      taxonomy: "UTILITY" as Taxonomy,
      confidence: 0.85,
      businessPurpose: "Type definition — provides type safety across the codebase",
      featureTag: "type-system",
      reason: "type-only entity kind",
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

  return null
}

/**
 * Route an entity to the appropriate model tier.
 * Takes optional centrality score for premium routing.
 */
export function routeModel(
  entity: EntityDoc,
  opts?: { centrality?: number; hasComplexDependencies?: boolean }
): ModelRoute {
  const defaultModel = process.env.LLM_DEFAULT_MODEL ?? "gpt-4o-mini"

  // Check heuristics first
  const heuristic = applyHeuristics(entity)
  if (heuristic) {
    return {
      tier: "heuristic" as ModelTier,
      reason: heuristic.reason,
    }
  }

  // Premium tier: high centrality or complex dependency graphs
  if ((opts?.centrality ?? 0) > 0.8 || opts?.hasComplexDependencies) {
    return {
      tier: "premium" as ModelTier,
      model: "gpt-4o",
      reason: "high centrality or complex dependencies",
    }
  }

  // Fast tier: simple entities (variables, standalone functions)
  const kind = entity.kind ?? ""
  if (["variable", "constant"].includes(kind)) {
    return {
      tier: "fast" as ModelTier,
      model: "gpt-4o-mini",
      reason: "simple entity kind",
    }
  }

  // Standard tier: everything else
  return {
    tier: "standard" as ModelTier,
    model: defaultModel,
    reason: "default routing",
  }
}
