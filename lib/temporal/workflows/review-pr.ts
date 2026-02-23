/**
 * reviewPrWorkflow — Four-activity Temporal workflow for PR review pipeline.
 * fetchDiff → runChecks → analyzeImpact → postReview
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as activities from "../activities/review"

const { fetchDiffAndRunChecks, postReviewSelfSufficient } = proxyActivities<typeof activities>({
  startToCloseTimeout: "120s",
  retry: { maximumAttempts: 3 },
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
  // Activity 1: Fetch diff + run all checks (combined — no large payloads in workflow)
  const { hasChanges, findings } = await fetchDiffAndRunChecks({
    orgId: input.orgId,
    repoId: input.repoId,
    owner: input.owner,
    repo: input.repo,
    baseSha: input.baseSha,
    headSha: input.headSha,
    installationId: input.installationId,
  })

  // Activity 2: Post review (re-fetches diff internally — only findings cross Temporal)
  await postReviewSelfSufficient({
    orgId: input.orgId,
    repoId: input.repoId,
    reviewId: input.reviewId,
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    headSha: input.headSha,
    baseSha: input.baseSha,
    installationId: input.installationId,
    findings: hasChanges
      ? findings
      : { pattern: [], impact: [], test: [], complexity: [], dependency: [], trustBoundary: [], env: [], contract: [], idempotency: [] },
  })
}
