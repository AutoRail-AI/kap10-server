/**
 * commit-graph — Phase 13 (C-04): Temporal activity for commit graph pre-computation.
 *
 * After each new SCIP index upload, this activity walks the commit graph and
 * populates the NearestIndexedCommit cache for reachable commits.
 *
 * Runs on light-llm-queue (network/DB bound, not CPU-bound).
 */

import { preComputeNearestIndexed } from "@/lib/indexer/commit-graph"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "commit-graph-activity" })

export interface PreComputeCommitGraphInput {
  orgId: string
  repoId: string
  /** The commit SHA that was just indexed (has a new ScipIndex row) */
  indexedSha: string
}

export interface PreComputeCommitGraphResult {
  updated: number
}

/**
 * Pre-compute nearest indexed commit cache entries for all commits
 * reachable from the newly indexed commit.
 */
export async function preComputeCommitGraph(
  input: PreComputeCommitGraphInput,
): Promise<PreComputeCommitGraphResult> {
  log.info("Starting commit graph pre-computation", {
    orgId: input.orgId,
    repoId: input.repoId,
    indexedSha: input.indexedSha.slice(0, 8),
  })

  const updated = await preComputeNearestIndexed(
    input.orgId,
    input.repoId,
    input.indexedSha,
  )

  log.info("Commit graph pre-computation complete", {
    orgId: input.orgId,
    repoId: input.repoId,
    indexedSha: input.indexedSha.slice(0, 8),
    updated,
  })

  return { updated }
}
