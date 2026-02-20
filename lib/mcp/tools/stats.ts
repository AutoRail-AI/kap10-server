/**
 * get_project_stats MCP tool — aggregated project statistics.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

export const GET_PROJECT_STATS_SCHEMA = {
  name: "get_project_stats",
  description:
    "Get high-level statistics about the repository including file/entity counts and language distribution. No arguments needed — uses the repository context from your API key.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
}

export async function handleGetProjectStats(
  _args: Record<string, never>,
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  const [stats, repo] = await Promise.all([
    container.graphStore.getProjectStats(ctx.orgId, repoId),
    container.relationalStore.getRepo(ctx.orgId, repoId),
  ])

  return formatToolResponse({
    name: repo?.fullName ?? repo?.name ?? repoId,
    ...stats,
    lastIndexedAt: repo?.lastIndexedAt?.toISOString() ?? null,
    indexedSha: repo?.lastIndexedSha ?? null,
    status: repo?.status ?? "unknown",
  })
}
