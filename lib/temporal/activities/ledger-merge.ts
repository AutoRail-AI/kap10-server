/**
 * Ledger merge activities — fetch, reparent, create merge node, synthesize, store.
 */

import { getContainer } from "@/lib/di/container"
import type { LedgerEntry } from "@/lib/ports/types"

export async function fetchLedgerEntries(input: {
  orgId: string
  repoId: string
  branch: string
}): Promise<LedgerEntry[]> {
  const container = getContainer()
  const result = await container.graphStore.queryLedgerTimeline({
    orgId: input.orgId,
    repoId: input.repoId,
    branch: input.branch,
    limit: 500,
  })
  return result.items
}

export async function reparentLedgerEntries(input: {
  orgId: string
  repoId: string
  entryIds: string[]
  targetBranch: string
}): Promise<void> {
  const container = getContainer()
  // Mark entries as committed (they've been merged)
  for (const entryId of input.entryIds) {
    try {
      await container.graphStore.updateLedgerEntryStatus(input.orgId, entryId, "committed")
    } catch {
      // Entry may already be committed — skip
    }
  }
}

export async function createMergeNode(input: {
  orgId: string
  repoId: string
  sourceBranch: string
  targetBranch: string
  prNumber: number
  mergedBy: string
  entryCount: number
}): Promise<void> {
  const container = getContainer()
  const mergeId = `merge-${input.orgId}-${input.repoId}-pr-${input.prNumber}`

  await container.graphStore.appendLedgerSummary(input.orgId, {
    id: mergeId,
    commit_sha: `pr-${input.prNumber}`,
    org_id: input.orgId,
    repo_id: input.repoId,
    user_id: input.mergedBy,
    branch: input.targetBranch,
    entry_count: input.entryCount,
    prompt_summary: `Merge PR #${input.prNumber}: ${input.sourceBranch} → ${input.targetBranch}`,
    total_files_changed: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    rewind_count: 0,
    rules_generated: [],
    created_at: new Date().toISOString(),
  })
}

export async function synthesizeLedgerSummary(input: {
  orgId: string
  repoId: string
  entries: LedgerEntry[]
  prNumber: number
  sourceBranch: string
  targetBranch: string
}): Promise<string | null> {
  const container = getContainer()

  try {
    const prompts = input.entries.map((e) => e.prompt).filter(Boolean)
    if (prompts.length === 0) return null

    const { summarizeLedger } = await import("@/lib/use-cases/summarizer")
    return await summarizeLedger(container.llmProvider, {
      prNumber: input.prNumber,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      prompts,
      entryCount: input.entries.length,
    })
  } catch (error: unknown) {
    console.error("[synthesizeLedgerSummary] LLM failed:", error instanceof Error ? error.message : String(error))
    return null
  }
}

export async function storeLedgerSummary(input: {
  orgId: string
  repoId: string
  branch: string
  prNumber: number
  narrative: string
  entryCount: number
}): Promise<void> {
  const container = getContainer()

  // Update the merge node with the narrative
  const summaries = await container.graphStore.queryLedgerSummaries(input.orgId, input.repoId, input.branch, 1)
  if (summaries.length > 0 && summaries[0]) {
    // The narrative goes into prompt_summary
    await container.graphStore.appendLedgerSummary(input.orgId, {
      ...summaries[0],
      prompt_summary: input.narrative,
    })
  }
}
