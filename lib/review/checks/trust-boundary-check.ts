/**
 * Trust Boundary Check (G1) — detects source→sink paths bypassing validation/auth middleware.
 */

import type {
  EntityDoc,
  ReviewConfig,
  TrustBoundaryFinding,
} from "@/lib/ports/types"
import type { IGraphStore } from "@/lib/ports/graph-store"

const AUTH_PATTERNS = /auth|valid|sanitiz|middleware|guard|protect|verify|permission/i
const DB_MUTATION_PATTERNS = /insert|update|delete|upsert|save|create|remove|destroy|drop|write/i

export async function runTrustBoundaryCheck(
  orgId: string,
  repoId: string,
  affectedEntities: Array<EntityDoc & { changedLines?: unknown }>,
  graphStore: IGraphStore,
  config: ReviewConfig
): Promise<TrustBoundaryFinding[]> {
  if (!config.checksEnabled.trustBoundary) return []

  const findings: TrustBoundaryFinding[] = []

  for (const entity of affectedEntities) {
    // Only check functions and methods
    if (entity.kind !== "function" && entity.kind !== "method") continue

    try {
      // Get callers (who calls this entity — upstream)
      const callers = await graphStore.getCallersOf(orgId, entity.id, 3)
      // Get callees (what this entity calls — downstream)
      const callees = await graphStore.getCalleesOf(orgId, entity.id, 3)

      // Check if entity is reachable from an API route handler
      const sourceRoutes = callers.filter((c) => c.kind === "api_route")
      if (sourceRoutes.length === 0) continue

      // Check if entity (or its callees) reaches a DB mutation
      const sinkMutations = callees.filter(
        (c) =>
          DB_MUTATION_PATTERNS.test(c.name) ||
          c.kind === "method" && DB_MUTATION_PATTERNS.test(c.name)
      )
      if (sinkMutations.length === 0) continue

      // Check if any entity on the path has auth/validation pattern
      const allOnPath = [...callers, entity, ...callees]
      const hasValidator = allOnPath.some(
        (e) =>
          AUTH_PATTERNS.test(e.name) ||
          (e as { architectural_pattern?: string }).architectural_pattern === "adapter"
      )

      // Also check justifications for auth patterns
      if (!hasValidator) {
        let justificationHasAuth = false
        try {
          const justification = await graphStore.getJustification(orgId, entity.id)
          if (justification) {
            justificationHasAuth =
              AUTH_PATTERNS.test(justification.business_purpose) ||
              justification.feature_tag.toLowerCase().includes("auth")
          }
        } catch {
          // Skip justification check on error
        }

        if (!justificationHasAuth) {
          for (const sink of sinkMutations.slice(0, 3)) {
            findings.push({
              sourceEntity: {
                id: sourceRoutes[0]!.id,
                name: sourceRoutes[0]!.name,
                filePath: sourceRoutes[0]!.file_path,
              },
              sinkEntity: {
                id: sink.id,
                name: sink.name,
                filePath: sink.file_path,
              },
              pathLength: 2, // simplified: route → entity → mutation
              filePath: entity.file_path,
              line: (entity as { start_line?: number }).start_line ?? 1,
              message: `Trust boundary gap: API route \`${sourceRoutes[0]!.name}\` reaches DB mutation \`${sink.name}\` through \`${entity.name}\` without apparent auth/validation middleware.`,
            })
          }
        }
      }
    } catch {
      // Skip entities with graph traversal errors
    }
  }

  return findings
}
