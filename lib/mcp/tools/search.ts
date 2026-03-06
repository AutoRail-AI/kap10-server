/**
 * search_code MCP tool — keyword search across entity names + signatures.
 */

import type { Container } from "@/lib/di/container"
import { resolveEntityWithOverlay } from "./dirty-buffer"
import { isPrimaryScope, resolveScope } from "./scope-resolver"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

export const SEARCH_CODE_SCHEMA = {
  name: "search_code",
  description:
    "Search for code entities (functions, classes, variables) by keyword. Returns matching entities with file paths and line numbers sorted by relevance.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Search query — matches entity names and signatures",
      },
      limit: {
        type: "number",
        description: "Maximum results to return (default 20, max 50)",
      },
      scope: {
        type: "string",
        description: "Entity scope: 'primary' (default), 'branch:{name}', or 'workspace:{keyId}'",
      },
    },
    required: ["query"],
  },
}

export async function handleSearchCode(
  args: { query: string; limit?: number; scope?: string },
  ctx: McpAuthContext,
  container: Container
) {
  if (!args.query || args.query.trim().length === 0) {
    return formatToolError("query parameter is required and cannot be empty")
  }

  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  const scope = resolveScope(args, ctx)
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50)

  // For non-primary scopes, use scope-aware query then filter by name match
  const results = !isPrimaryScope(scope)
    ? (await container.graphStore.queryEntitiesWithScope(
        ctx.orgId, repoId, scope, { limit }
      )).filter((e) => {
        const q = args.query.trim().toLowerCase()
        return e.name.toLowerCase().includes(q) ||
          (e.signature && String(e.signature).toLowerCase().includes(q))
      }).map((e) => ({ ...e, score: 1 }))
    : await container.graphStore.searchEntities(ctx.orgId, repoId, args.query.trim(), limit)

  // P5.6-ADV-05: Check dirty buffer overlay for search results
  try {
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      const overlay = await resolveEntityWithOverlay(
        container,
        ctx.orgId,
        repoId,
        r.name
      )
      if (overlay?.source === "dirty_buffer") {
        // Annotate result with dirty buffer source
        results[i] = { ...r, _source: "dirty_buffer" } as typeof r & { _source: string }
      }
    }
  } catch {
    // Overlay is best-effort
  }

  return formatToolResponse({
    query: args.query,
    results,
    count: results.length,
  })
}
