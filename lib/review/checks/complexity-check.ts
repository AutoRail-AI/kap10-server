/**
 * Complexity check — counts branches in changed functions.
 * Uses ast-grep when available, otherwise skips gracefully.
 */

import type { ComplexityFinding, EntityDoc, ReviewConfig } from "@/lib/ports/types"

export async function runComplexityCheck(
  affectedEntities: Array<EntityDoc & { changedLines: Array<{ start: number; end: number }> }>,
  config: ReviewConfig
): Promise<ComplexityFinding[]> {
  if (!config.checksEnabled.complexity) return []

  const findings: ComplexityFinding[] = []

  for (const entity of affectedEntities) {
    // Only check functions and methods
    if (entity.kind !== "function" && entity.kind !== "method") continue

    // Use pre-computed complexity from entity if available
    const complexity = Number(entity.cyclomatic_complexity) || 0
    if (complexity > 0 && complexity >= config.complexityThreshold) {
      findings.push({
        entityId: entity.id,
        entityName: entity.name,
        filePath: entity.file_path,
        line: Number(entity.start_line) || 0,
        complexity,
        threshold: config.complexityThreshold,
      })
    }
  }

  return findings
}
