/**
 * Shadow rewind use case — calculates blast radius before actually reverting.
 * Phase 5.5: Prompt Ledger & Rewind
 */

import type { Container } from "@/lib/di/container"
import type { SimulateRewindResult } from "@/lib/ports/types"

export async function simulateShadowRewind(
  container: Container,
  orgId: string,
  repoId: string,
  branch: string,
  targetEntryId: string
): Promise<SimulateRewindResult> {
  // 1. Get the target entry (the known-good working state)
  const targetEntry = await container.graphStore.getLedgerEntry(orgId, targetEntryId)
  if (!targetEntry) throw new Error(`Target entry ${targetEntryId} not found`)

  // 2. Get all uncommitted entries after the target
  const uncommitted = await container.graphStore.getUncommittedEntries(orgId, repoId, branch)
  const entriesToRevert = uncommitted.filter(
    (e) => e.created_at > targetEntry.created_at && e.id !== targetEntryId
  )

  // 3. Collect all files changed in entries to be reverted
  const fileChanges = new Map<string, { entryIds: string[]; lineRanges: string[] }>()
  for (const entry of entriesToRevert) {
    for (const change of entry.changes) {
      const existing = fileChanges.get(change.file_path) ?? { entryIds: [], lineRanges: [] }
      existing.entryIds.push(entry.id)
      existing.lineRanges.push(`${change.lines_added}+/${change.lines_removed}-`)
      fileChanges.set(change.file_path, existing)
    }
  }

  // 4. Check for conflicts: files changed in both entries-to-revert AND in the target entry
  const targetFiles = new Set(targetEntry.changes.map((c) => c.file_path))

  const safeFiles: string[] = []
  const conflictedFiles: Array<{ filePath: string; lineRanges: string[] }> = []
  const manualChangesAtRisk: Array<{ filePath: string; lineRanges: string[] }> = []

  for (const [filePath, info] of Array.from(fileChanges.entries())) {
    if (targetFiles.has(filePath)) {
      conflictedFiles.push({ filePath, lineRanges: info.lineRanges })
    } else if (info.entryIds.length > 1) {
      manualChangesAtRisk.push({ filePath, lineRanges: info.lineRanges })
    } else {
      safeFiles.push(filePath)
    }
  }

  return { safeFiles, conflictedFiles, manualChangesAtRisk }
}
