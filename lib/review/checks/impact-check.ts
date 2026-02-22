/**
 * Impact check — traverses ArangoDB call graph to find callers of changed entities.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"
import type { EntityDoc, ImpactFinding, ReviewConfig } from "@/lib/ports/types"

export async function runImpactCheck(
  orgId: string,
  affectedEntities: Array<EntityDoc & { changedLines: Array<{ start: number; end: number }> }>,
  graphStore: IGraphStore,
  config: ReviewConfig
): Promise<ImpactFinding[]> {
  if (!config.checksEnabled.impact) return []

  const findings: ImpactFinding[] = []

  for (const entity of affectedEntities) {
    const callers = await graphStore.getCallersOf(orgId, entity.id)
    const callerCount = callers.length

    if (callerCount >= config.impactThreshold) {
      findings.push({
        entityId: entity.id,
        entityName: entity.name,
        filePath: entity.file_path,
        line: Number(entity.start_line) || 0,
        callerCount,
        topCallers: callers.slice(0, 5).map((c) => ({
          name: c.name,
          filePath: c.file_path,
        })),
      })
    }
  }

  return findings
}
