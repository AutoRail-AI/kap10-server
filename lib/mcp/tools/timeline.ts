/**
 * Phase 5.5: MCP tools for the Prompt Ledger timeline.
 *
 * 2 tools:
 * 1. get_timeline     — paginated ledger timeline query
 * 2. mark_working     — mark a ledger entry as a known-good working state
 */

import * as crypto from "node:crypto"
import type { Container } from "@/lib/di/container"
import type { LedgerEntryStatus, SnapshotFile, WorkingSnapshot } from "@/lib/ports/types"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

// ── get_timeline ─────────────────────────────────────────────────

export const GET_TIMELINE_SCHEMA = {
  name: "get_timeline",
  description:
    "Get the prompt ledger timeline for this repository, showing a chronological log of all AI-assisted changes, their status, and timeline branches.",
  inputSchema: {
    type: "object" as const,
    properties: {
      branch: {
        type: "string",
        description: 'Branch to query (default: "main")',
      },
      timeline_branch: {
        type: "number",
        description: "Filter by timeline branch number",
      },
      status: {
        type: "string",
        description: "Filter by entry status: pending, working, broken, committed, or reverted",
        enum: ["pending", "working", "broken", "committed", "reverted"],
      },
      limit: {
        type: "number",
        description: "Maximum number of entries to return (default 50)",
      },
      cursor: {
        type: "string",
        description: "Pagination cursor from a previous response",
      },
    },
    required: [],
  },
}

export async function handleGetTimeline(
  args: {
    branch?: string
    timeline_branch?: number
    status?: string
    limit?: number
    cursor?: string
  },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  const branch = args.branch ?? "main"
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200)
  const status = args.status as LedgerEntryStatus | undefined

  try {
    const result = await container.graphStore.queryLedgerTimeline({
      orgId: ctx.orgId,
      repoId,
      branch,
      timelineBranch: args.timeline_branch,
      status,
      limit,
      cursor: args.cursor,
    })

    const items = result.items.map((entry) => ({
      id: entry.id,
      status: entry.status,
      prompt:
        entry.prompt.length > 200
          ? `${entry.prompt.slice(0, 200)}…`
          : entry.prompt,
      branch: entry.branch,
      timeline_branch: entry.timeline_branch,
      changes_count: entry.changes.length,
      agent_model: entry.agent_model ?? null,
      created_at: entry.created_at,
    }))

    return formatToolResponse({
      items,
      cursor: result.cursor,
      hasMore: result.hasMore,
      count: items.length,
      branch,
    })
  } catch (error: unknown) {
    return formatToolError(error instanceof Error ? error.message : String(error))
  }
}

// ── mark_working ─────────────────────────────────────────────────

export const MARK_WORKING_SCHEMA = {
  name: "mark_working",
  description:
    "Mark a ledger entry as a known-good working state. This creates a snapshot that can be used as a rewind target.",
  inputSchema: {
    type: "object" as const,
    properties: {
      entry_id: {
        type: "string",
        description: "ID of the ledger entry to mark as working",
      },
      files: {
        type: "array",
        description: "The working-state file contents to snapshot",
        items: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Relative path to the file",
            },
            content: {
              type: "string",
              description: "Full file content at the working state",
            },
          },
          required: ["file_path", "content"],
        },
      },
    },
    required: ["entry_id", "files"],
  },
}

export async function handleMarkWorking(
  args: {
    entry_id: string
    files: Array<{ file_path: string; content: string }>
  },
  ctx: McpAuthContext,
  container: Container
) {
  if (!ctx.userId) {
    return formatToolError(
      "mark_working requires user context (OAuth authentication). API key mode does not support this tool without a user ID."
    )
  }

  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  if (!args.entry_id) {
    return formatToolError("entry_id parameter is required")
  }

  if (!Array.isArray(args.files) || args.files.length === 0) {
    return formatToolError("files parameter is required and must be a non-empty array")
  }

  try {
    // Update the ledger entry status to "working"
    await container.graphStore.updateLedgerEntryStatus(ctx.orgId, args.entry_id, "working")

    // Retrieve the entry to get branch and timeline_branch
    const entry = await container.graphStore.getLedgerEntry(ctx.orgId, args.entry_id)
    if (!entry) {
      return formatToolError(`Ledger entry "${args.entry_id}" not found`)
    }

    // Build snapshot files — entity_hashes are empty; they'd be computed async
    const snapshotFiles: SnapshotFile[] = args.files.map((f) => ({
      file_path: f.file_path,
      content: f.content,
      entity_hashes: [],
    }))

    const snapshotId = crypto.randomUUID()
    const snapshot: WorkingSnapshot = {
      id: snapshotId,
      org_id: ctx.orgId,
      repo_id: repoId,
      user_id: ctx.userId,
      branch: entry.branch,
      timeline_branch: entry.timeline_branch,
      ledger_entry_id: args.entry_id,
      reason: "user_marked",
      files: snapshotFiles,
      created_at: new Date().toISOString(),
    }

    await container.graphStore.appendWorkingSnapshot(ctx.orgId, snapshot)

    return formatToolResponse({
      status: "marked",
      snapshotId,
      entryId: args.entry_id,
    })
  } catch (error: unknown) {
    return formatToolError(error instanceof Error ? error.message : String(error))
  }
}
