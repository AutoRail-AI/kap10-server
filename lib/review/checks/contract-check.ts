/**
 * API Contract Check (G10) — detects changes to entities that blast radius shows affect API boundaries.
 */

import type {
  BlastRadiusSummary,
  ContractFinding,
  EntityDoc,
  ReviewConfig,
} from "@/lib/ports/types"

const API_BOUNDARY_KINDS = new Set(["api_route", "webhook_handler"])

export async function runContractCheck(
  orgId: string,
  affectedEntities: Array<EntityDoc & { changedLines?: unknown }>,
  blastRadius: BlastRadiusSummary[],
  config: ReviewConfig
): Promise<ContractFinding[]> {
  if (!config.checksEnabled.contract) return []

  const findings: ContractFinding[] = []

  for (const br of blastRadius) {
    // Find API boundary nodes in the blast radius
    const apiBoundaries = br.upstreamBoundaries.filter((b) =>
      API_BOUNDARY_KINDS.has(b.kind)
    )
    if (apiBoundaries.length === 0) continue

    // Find the matching affected entity
    const entity = affectedEntities.find(
      (e) => e.name === br.entity || e.id === br.entity
    )
    if (!entity) continue

    for (const route of apiBoundaries) {
      // Severity scales with caller count
      const severity = br.callerCount >= 10 ? "high" : br.callerCount >= 3 ? "medium" : "low"

      findings.push({
        changedEntity: {
          id: entity.id,
          name: entity.name,
          filePath: entity.file_path,
        },
        affectedRoute: {
          name: route.name,
          kind: route.kind,
          filePath: route.filePath,
        },
        depth: route.depth,
        callerCount: br.callerCount,
        filePath: entity.file_path,
        line: (entity as { start_line?: number }).start_line ?? 1,
        message: `Changing \`${entity.name}\` may break API contract for \`${route.name}\` (${route.kind}, ${route.depth} hops away, ${br.callerCount} total callers). Verify the ${severity === "high" ? "widely-used" : ""} API response shape is preserved.`,
      })
    }
  }

  return findings
}
