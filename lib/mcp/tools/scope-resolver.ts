/**
 * scope-resolver — Phase 13 (C-07/C-08): Resolve entity scope for MCP tool queries.
 *
 * Centralizes scope resolution logic so every MCP tool that queries entities
 * gets consistent behavior:
 *   1. Explicit `scope` arg takes priority
 *   2. If auth context has a workspaceId, use workspace scope
 *   3. Default to "primary"
 *
 * For branch/workspace scopes, integrates with the visible uploads algorithm
 * (C-08): if the scope's commit has no direct SCIP index, finds the nearest
 * indexed ancestor for position adjustment.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"

/**
 * Resolve which scope to use for an MCP tool query.
 *
 * Priority:
 *   1. Explicit `scope` arg from the tool input
 *   2. `workspaceId` from auth context → "workspace:{workspaceId}"
 *   3. "primary"
 */
export function resolveScope(
  args: { scope?: string; branch?: string },
  ctx: McpAuthContext,
): string {
  // Explicit scope wins
  if (args.scope) return args.scope

  // Branch shorthand: "feature/auth" → "branch:feature/auth"
  if (args.branch) return `branch:${args.branch}`

  // Workspace from auth context (set when MCP key is scoped to a workspace)
  if (ctx.workspaceId) return `workspace:${ctx.workspaceId}`

  return "primary"
}

/**
 * Check if a scope is the default primary scope.
 * Useful for deciding whether to use scope-aware or standard queries.
 */
export function isPrimaryScope(scope: string): boolean {
  return scope === "primary" || scope === ""
}

export interface ScopeResolvedQuery {
  scope: string
  /** If the query commit has no direct SCIP index, the nearest indexed ancestor */
  nearestSha?: string
  /** Distance from query commit to nearest indexed commit */
  distance?: number
}

/**
 * For non-primary scopes, attempt to find the nearest indexed commit
 * for visible uploads position adjustment.
 *
 * V1: Returns the scope as-is. Nearest commit lookup is best-effort
 * and only meaningful when a specific commit SHA is being queried
 * (future: C-08 full integration with position adjustment).
 */
export async function resolveScopeForQuery(
  orgId: string,
  repoId: string,
  scope: string,
  _container: Container,
): Promise<ScopeResolvedQuery> {
  if (isPrimaryScope(scope)) {
    return { scope: "primary" }
  }

  // For branch/workspace scopes, the queryEntitiesWithScope method handles
  // the fallback to primary entities automatically. The visible uploads
  // algorithm (nearest indexed commit + position adjustment) is only needed
  // when querying at a specific commit SHA that has no SCIP index.
  //
  // V1: We don't adjust positions yet — the scope-first query pattern in
  // ArangoDB already provides correct results for branch-scoped entities.
  // Position adjustment (C-03) will be wired in when C-08 is fully integrated.
  return { scope }
}
