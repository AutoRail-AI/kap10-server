/**
 * Dead code detection via graph analysis.
 *
 * Zero inbound calls + not exported = dead code. Pure graph analysis, no LLM needed.
 * Dead code entities get auto-classified as UTILITY with feature_tag "dead_code".
 */

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

const TEST_FILE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /\/__tests__\//,
  /\/test\//,
]

const ENTRY_POINT_PATTERNS = [
  /\/route\.(ts|js)$/,
  /\/page\.(tsx|jsx)$/,
  /\/layout\.(tsx|jsx)$/,
  /\/middleware\.(ts|js)$/,
  /\/proxy\.(ts|js)$/,
  /main\.(ts|js)$/,
  /index\.(ts|js)$/,
  /cli\.(ts|js)$/,
]

/**
 * Detect dead code entities: functions/classes with no inbound references
 * that are not exported, not in test files, and not entry points.
 *
 * @returns Set of entity IDs identified as dead code
 */
export function detectDeadCode(
  entities: EntityDoc[],
  edges: EdgeDoc[]
): Set<string> {
  const deadCode = new Set<string>()

  // Build set of entities with inbound references (calls or references)
  const hasInbound = new Set<string>()
  for (const edge of edges) {
    if (edge.kind === "calls" || edge.kind === "references" || edge.kind === "imports") {
      const toId = edge._to.split("/").pop()!
      hasInbound.add(toId)
    }
  }

  for (const entity of entities) {
    // Skip file/module/namespace/directory entities
    if (entity.kind === "file" || entity.kind === "module" || entity.kind === "namespace" || entity.kind === "directory") {
      continue
    }

    // Skip test entities
    if (TEST_FILE_PATTERNS.some((p) => p.test(entity.file_path))) {
      continue
    }

    // Skip entry points
    if (ENTRY_POINT_PATTERNS.some((p) => p.test(entity.file_path))) {
      continue
    }

    // Skip exported entities (public API) — heuristic: top-level entities without a parent
    // are potentially exported. Entities with `exported` flag set are definitely exported.
    if ((entity as Record<string, unknown>).exported === true) {
      continue
    }

    // Skip types/interfaces/enums (they're used at compile time, not runtime calls)
    if (entity.kind === "type" || entity.kind === "interface" || entity.kind === "enum") {
      continue
    }

    // Skip constructors (called implicitly via `new`)
    if (entity.name === "constructor" || entity.name === "__init__") {
      continue
    }

    // Entity with zero inbound references → dead code candidate
    if (!hasInbound.has(entity.id)) {
      deadCode.add(entity.id)
    }
  }

  return deadCode
}
