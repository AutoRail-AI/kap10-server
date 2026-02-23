/**
 * reviewPrWorkflow — Four-activity Temporal workflow for PR review pipeline.
 * fetchDiff → runChecks → analyzeImpact → postReview
 */

import { proxyActivities, sleep } from "@temporalio/workflow"
import type * as activities from "../activities/review"

const { fetchDiff, runChecks, postReview: postReviewActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "60s",
  retry: { maximumAttempts: 3 },
})

const { runChecksHeavy } = proxyActivities<typeof activities>({
  taskQueue: "heavy-compute-queue",
  startToCloseTimeout: "120s",
  retry: { maximumAttempts: 2 },
})

export interface ReviewPrInput {
  orgId: string
  repoId: string
  prNumber: number
  installationId: number
  headSha: string
  baseSha: string
  owner: string
  repo: string
  reviewId: string
}

export async function reviewPrWorkflow(input: ReviewPrInput): Promise<void> {
  // Activity 1: Fetch and parse diff
  const diffResult = await fetchDiff({
    orgId: input.orgId,
    repoId: input.repoId,
    owner: input.owner,
    repo: input.repo,
    baseSha: input.baseSha,
    headSha: input.headSha,
    installationId: input.installationId,
  })

  if (diffResult.files.length === 0) {
    // No meaningful changes — skip review
    await postReviewActivity({
      orgId: input.orgId,
      repoId: input.repoId,
      reviewId: input.reviewId,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      headSha: input.headSha,
      installationId: input.installationId,
      diffFiles: [],
      affectedEntities: [],
      findings: { pattern: [], impact: [], test: [], complexity: [], dependency: [], trustBoundary: [], env: [], contract: [], idempotency: [] },
      blastRadius: [],
    })
    return
  }

  // Activity 2: Run all checks (pattern check on heavy queue, others on light)
  const findings = await runChecks({
    orgId: input.orgId,
    repoId: input.repoId,
    diffFiles: diffResult.files,
    affectedEntities: diffResult.affectedEntities,
    installationId: input.installationId,
    blastRadius: diffResult.blastRadius,
  })

  // Activity 3: Post review to GitHub + store in database
  await postReviewActivity({
    orgId: input.orgId,
    repoId: input.repoId,
    reviewId: input.reviewId,
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    headSha: input.headSha,
    installationId: input.installationId,
    diffFiles: diffResult.files,
    affectedEntities: diffResult.affectedEntities,
    findings,
    blastRadius: diffResult.blastRadius ?? [],
  })
}
