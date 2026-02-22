/**
 * mergeLedgerWorkflow — Five-activity workflow for PR merge ledger operations.
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as activities from "../activities/ledger-merge"

const act = proxyActivities<typeof activities>({
  startToCloseTimeout: "60s",
  retry: { maximumAttempts: 3 },
})

export interface MergeLedgerInput {
  orgId: string
  repoId: string
  sourceBranch: string
  targetBranch: string
  prNumber: number
  mergedBy: string
}

export async function mergeLedgerWorkflow(input: MergeLedgerInput): Promise<void> {
  // Activity 1: Fetch ledger entries for the source branch
  const entries = await act.fetchLedgerEntries({
    orgId: input.orgId,
    repoId: input.repoId,
    branch: input.sourceBranch,
  })

  if (entries.length === 0) return

  // Activity 2: Reparent ledger entries to target branch
  await act.reparentLedgerEntries({
    orgId: input.orgId,
    repoId: input.repoId,
    entryIds: entries.map((e) => e.id),
    targetBranch: input.targetBranch,
  })

  // Activity 3: Create merge node
  await act.createMergeNode({
    orgId: input.orgId,
    repoId: input.repoId,
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
    prNumber: input.prNumber,
    mergedBy: input.mergedBy,
    entryCount: entries.length,
  })

  // Activity 4: Synthesize narrative summary (LLM)
  const narrative = await act.synthesizeLedgerSummary({
    orgId: input.orgId,
    repoId: input.repoId,
    entries,
    prNumber: input.prNumber,
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
  })

  // Activity 5: Store summary
  if (narrative) {
    await act.storeLedgerSummary({
      orgId: input.orgId,
      repoId: input.repoId,
      branch: input.targetBranch,
      prNumber: input.prNumber,
      narrative,
      entryCount: entries.length,
    })
  }
}
