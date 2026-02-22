/**
 * prFollowUpWorkflow — 48-hour nudge for blocked PRs.
 */

import { proxyActivities, sleep } from "@temporalio/workflow"
import type * as activities from "../activities/review"

const act = proxyActivities<typeof activities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 },
})

export interface PrFollowUpInput {
  orgId: string
  repoId: string
  prNumber: number
  reviewId: string
  owner: string
  repo: string
  headSha: string
  installationId: number
  nudgeDelayHours?: number
}

export async function prFollowUpWorkflow(input: PrFollowUpInput): Promise<{ action: string; reason?: string }> {
  const delayHours = input.nudgeDelayHours ?? 48
  await sleep(`${delayHours}h`)

  const result = await act.checkAndPostNudge({
    orgId: input.orgId,
    repoId: input.repoId,
    prNumber: input.prNumber,
    reviewId: input.reviewId,
    owner: input.owner,
    repo: input.repo,
    headSha: input.headSha,
    installationId: input.installationId,
  })

  return result
}
