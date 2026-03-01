/**
 * L-14: refresh_context MCP tool — allows agents to trigger incremental
 * profile cache refresh for files they've modified mid-session.
 *
 * When an agent changes code during an agentic loop, cached profiles
 * become stale. This tool re-computes profiles for affected entities
 * without requiring a full re-index.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

export const REFRESH_CONTEXT_SCHEMA = {
  name: "refresh_context",
  description:
    "Refresh entity profiles for specific files. Call this after modifying files " +
    "to ensure subsequent queries reflect your changes. Lightweight: re-reads " +
    "entities from the graph, re-computes profiles, and updates the cache.",
  inputSchema: {
    type: "object" as const,
    properties: {
      files: {
        type: "array",
        items: { type: "string" },
        description: "File paths to refresh (repo-root-relative)",
      },
    },
    required: ["files"],
  },
}

export async function handleRefreshContext(
  args: { files: string[] },
  ctx: McpAuthContext,
  container: Container,
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  if (!args.files || args.files.length === 0) {
    return formatToolError("files parameter is required and must contain at least one file path")
  }

  // Cap at 20 files per refresh to avoid abuse
  const files = args.files.slice(0, 20)

  try {
    const { getEntityProfile, profileCacheKey } = require("@/lib/mcp/entity-profile") as typeof import("@/lib/mcp/entity-profile")

    let profilesRefreshed = 0
    const refreshedEntities: Array<{ name: string; file_path: string }> = []

    for (const filePath of files) {
      const entities = await container.graphStore.getEntitiesByFile(
        ctx.orgId,
        repoId,
        filePath,
      )

      for (const entity of entities) {
        // Invalidate existing cache entry
        try {
          await container.cacheStore.invalidate(profileCacheKey(ctx.orgId, repoId, entity.id))
        } catch {
          // Non-fatal
        }

        // Re-build profile (will be cached on read)
        const profile = await getEntityProfile(ctx.orgId, repoId, entity.id, container)
        if (profile) {
          profilesRefreshed++
          refreshedEntities.push({ name: entity.name, file_path: entity.file_path })
        }
      }
    }

    return formatToolResponse({
      profiles_refreshed: profilesRefreshed,
      files_processed: files.length,
      entities: refreshedEntities.slice(0, 50), // Cap response size
      _hint: profilesRefreshed > 0
        ? "Entity profiles are now up to date. Subsequent queries will reflect these changes."
        : "No entities found in the specified files.",
    })
  } catch (error: unknown) {
    return formatToolError(
      `Refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
