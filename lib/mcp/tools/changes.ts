/**
 * Phase 5: MCP tool for querying recent index changes.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError } from "../formatter"

export const GET_RECENT_CHANGES_SCHEMA = {
  name: "get_recent_changes",
  description: "Get recent indexing changes for a repository — shows push events, entity diffs, and cascade status. Useful for understanding what changed recently.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Maximum number of events to return (default 10, max 50)",
      },
    },
  },
}

export async function handleGetRecentChanges(
  args: Record<string, unknown>,
  ctx: McpAuthContext,
  container: Container
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50)
    const repoId = ctx.repoId ?? ""
    const events = await container.graphStore.getIndexEvents(ctx.orgId, repoId, limit)

    if (events.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No recent index events found for this repository.",
        }],
      }
    }

    const formatted = events.map((event) => {
      const parts = [
        `**${event.event_type}** — ${event.push_sha.slice(0, 8)}`,
        `  Message: ${event.commit_message || "(no message)"}`,
        `  Files changed: ${event.files_changed}`,
        `  Entities: +${event.entities_added} ~${event.entities_updated} -${event.entities_deleted}`,
        `  Edges repaired: ${event.edges_repaired}`,
        `  Embeddings updated: ${event.embeddings_updated}`,
        `  Cascade: ${event.cascade_status} (${event.cascade_entities} entities)`,
        `  Duration: ${event.duration_ms}ms`,
        `  Time: ${event.created_at}`,
      ]
      if (event.extraction_errors && event.extraction_errors.length > 0) {
        parts.push(`  ⚠ Extraction errors: ${event.extraction_errors.length}`)
        for (const err of event.extraction_errors) {
          parts.push(`    - ${err.filePath}: ${err.reason}${err.quarantined ? " (quarantined)" : ""}`)
        }
      }
      return parts.join("\n")
    })

    return {
      content: [{
        type: "text",
        text: `## Recent Changes (${events.length} events)\n\n${formatted.join("\n\n---\n\n")}`,
      }],
    }
  } catch (error: unknown) {
    return formatToolError(error instanceof Error ? error.message : String(error))
  }
}
