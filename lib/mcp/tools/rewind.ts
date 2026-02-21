/**
 * revert_to_working_state MCP tool — rewinds the ledger to a known-good state.
 * Phase 5.5: Prompt Ledger & Rewind
 */

import * as crypto from "node:crypto"
import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"
import { simulateShadowRewind } from "@/lib/use-cases/shadow-rewind"

export const REVERT_TO_WORKING_SCHEMA = {
  name: "revert_to_working_state",
  description:
    "Rewind the prompt ledger to a previous working state. First runs a shadow rewind to check blast radius, then atomically marks intermediate entries as reverted and creates a new timeline branch.",
  inputSchema: {
    type: "object" as const,
    properties: {
      target_entry_id: {
        type: "string",
        description: "The ledger entry ID to rewind to (must be a 'working' entry)",
      },
      dry_run: {
        type: "boolean",
        description:
          "If true, only simulate the rewind and return blast radius without making changes",
      },
    },
    required: ["target_entry_id"],
  },
}

export async function handleRevertToWorking(
  args: { target_entry_id: string; dry_run?: boolean },
  ctx: McpAuthContext,
  container: Container
) {
  if (!ctx.userId) {
    return formatToolError("revert_to_working_state requires user context.")
  }
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context.")
  }

  try {
    // 1. Get the target entry
    const targetEntry = await container.graphStore.getLedgerEntry(ctx.orgId, args.target_entry_id)
    if (!targetEntry) {
      return formatToolError(`Ledger entry ${args.target_entry_id} not found.`)
    }
    if (targetEntry.repo_id !== repoId) {
      return formatToolError("Target entry does not belong to this repository.")
    }

    // 2. Shadow rewind — blast radius check
    const blastRadius = await simulateShadowRewind(
      container,
      ctx.orgId,
      repoId,
      targetEntry.branch,
      args.target_entry_id
    )

    if (args.dry_run) {
      return formatToolResponse({
        status: "dry_run",
        blastRadius,
        targetEntry: {
          id: targetEntry.id,
          status: targetEntry.status,
          prompt: targetEntry.prompt.slice(0, 200),
        },
      })
    }

    // 3. Get entries to revert
    const uncommitted = await container.graphStore.getUncommittedEntries(
      ctx.orgId,
      repoId,
      targetEntry.branch
    )
    const entriesToRevert = uncommitted.filter(
      (e) => e.created_at > targetEntry.created_at && e.id !== args.target_entry_id
    )
    const entryIdsToRevert = entriesToRevert.map((e) => e.id)

    // 4. Atomic revert: mark entries as reverted
    if (entryIdsToRevert.length > 0) {
      await container.graphStore.markEntriesReverted(ctx.orgId, entryIdsToRevert)
    }

    // 5. Increment timeline branch
    const maxBranch = await container.graphStore.getMaxTimelineBranch(
      ctx.orgId,
      repoId,
      targetEntry.branch
    )
    const newTimelineBranch = maxBranch + 1

    // 6. Create rewind entry on new timeline branch
    const rewindEntryId = crypto.randomUUID()
    await container.graphStore.appendLedgerEntry(ctx.orgId, {
      id: rewindEntryId,
      org_id: ctx.orgId,
      repo_id: repoId,
      user_id: ctx.userId,
      branch: targetEntry.branch,
      timeline_branch: newTimelineBranch,
      prompt: `[REWIND] Reverted to entry ${args.target_entry_id}`,
      changes: [],
      status: "working",
      parent_id: args.target_entry_id,
      rewind_target_id: args.target_entry_id,
      commit_sha: null,
      snapshot_id: null,
      validated_at: new Date().toISOString(),
      rule_generated: null,
      blast_radius: {
        safeFiles: blastRadius.safeFiles,
        conflictedFiles: blastRadius.conflictedFiles.map((f) => f.filePath),
      },
      created_at: new Date().toISOString(),
    })

    // 7. Queue anti-pattern synthesis (fire-and-forget, don't block rewind)
    try {
      await container.workflowEngine.startWorkflow({
        taskQueue: "light-llm-queue",
        workflowId: `anti-pattern-${rewindEntryId}`,
        workflowFn: "synthesizeAntiPattern",
        args: [
          {
            orgId: ctx.orgId,
            repoId,
            rewindEntryId,
            revertedEntryIds: entryIdsToRevert,
            branch: targetEntry.branch,
          },
        ],
      })
    } catch {
      // Anti-pattern synthesis is best-effort
    }

    return formatToolResponse({
      status: "reverted",
      rewindEntryId,
      timelineBranch: newTimelineBranch,
      entriesReverted: entryIdsToRevert.length,
      blastRadius,
      targetEntry: { id: targetEntry.id, prompt: targetEntry.prompt.slice(0, 200) },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return formatToolError(`Rewind failed: ${message}`)
  }
}
