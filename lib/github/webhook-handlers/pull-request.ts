/**
 * Pull request webhook handler — handles opened, synchronize, reopened, closed events.
 */

import type { Container } from "@/lib/di/container"

export interface PullRequestPayload {
  action: string
  number: number
  pull_request: {
    number: number
    title: string
    html_url: string
    head: { sha: string; ref: string }
    base: { sha: string; ref: string }
    draft: boolean
    merged: boolean
    state: string
    user: { login: string }
  }
  repository: {
    id: number
    full_name: string
    default_branch: string
    owner: { login: string }
    name: string
  }
  installation?: { id: number }
  sender?: { login: string }
}

export async function handlePullRequestEvent(
  payload: PullRequestPayload,
  container: Container
): Promise<{ action: string; workflowId?: string; reason?: string }> {
  const installationId = payload.installation?.id
  if (!installationId) {
    return { action: "skipped", reason: "No installation ID" }
  }

  // Resolve org + repo
  const installation = await container.relationalStore.getInstallationByInstallationId(installationId)
  if (!installation) {
    return { action: "skipped", reason: "Installation not found" }
  }

  const repo = await container.relationalStore.getRepoByGithubId(
    installation.organizationId,
    payload.repository.id
  )
  if (!repo) {
    return { action: "skipped", reason: "Repo not registered" }
  }

  const orgId = installation.organizationId
  const repoId = repo.id
  const pr = payload.pull_request
  const owner = payload.repository.owner.login
  const repoName = payload.repository.name

  // Handle merge event
  if (payload.action === "closed" && pr.merged) {
    const sourceBranch = pr.head.ref
    const targetBranch = pr.base.ref

    // Start merge ledger workflow
    const workflowId = `merge-ledger-${orgId}-${repoId}-pr-${pr.number}`
    try {
      await container.workflowEngine.startWorkflow({
        workflowFn: "mergeLedgerWorkflow",
        workflowId,
        args: [{
          orgId,
          repoId,
          sourceBranch,
          targetBranch,
          prNumber: pr.number,
          mergedBy: payload.sender?.login ?? pr.user.login,
        }],
        taskQueue: "light-llm-queue",
      })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (!msg.includes("already started")) throw error
    }

    // Optionally trigger ADR generation
    const adrEnabled = process.env.ADR_ENABLED === "true"
    if (adrEnabled) {
      try {
        await container.workflowEngine.startWorkflow({
          workflowFn: "generateAdrWorkflow",
          workflowId: `adr-${orgId}-${repoId}-pr-${pr.number}`,
          args: [{
            orgId,
            repoId,
            prNumber: pr.number,
            prTitle: pr.title,
            mergedBy: payload.sender?.login ?? pr.user.login,
            owner,
            repo: repoName,
            installationId,
            headSha: pr.head.sha,
          }],
          taskQueue: "light-llm-queue",
        })
      } catch {
        // ADR workflow already started — skip
      }
    }

    return { action: "merge", workflowId }
  }

  // Handle closed without merge
  if (payload.action === "closed") {
    return { action: "skipped", reason: "PR closed without merge" }
  }

  // Handle review trigger: opened, synchronize, reopened
  const reviewActions = ["opened", "synchronize", "reopened"]
  if (!reviewActions.includes(payload.action)) {
    return { action: "skipped", reason: `Unknown action: ${payload.action}` }
  }

  // Guard: repo must be ready
  if (repo.status !== "ready") {
    return { action: "skipped", reason: `Repo not ready: ${repo.status}` }
  }

  // Get review config
  const config = await container.relationalStore.getRepoReviewConfig(repoId)

  // Guard: reviews enabled
  if (!config.enabled) {
    return { action: "skipped", reason: "Reviews disabled" }
  }

  // Guard: skip draft PRs
  if (config.skipDraftPrs && pr.draft) {
    return { action: "skipped", reason: "Draft PR skipped" }
  }

  // Guard: target branch matches
  const targetBranch = pr.base.ref
  if (config.targetBranches.length > 0 && !config.targetBranches.includes(targetBranch)) {
    return { action: "skipped", reason: `Target branch ${targetBranch} not in configured branches` }
  }

  // Idempotency check
  const existing = await container.relationalStore.getPrReviewByPrAndSha(repoId, pr.number, pr.head.sha)
  if (existing) {
    return { action: "skipped", reason: "Review already exists for this SHA" }
  }

  // Create PrReview record
  const review = await container.relationalStore.createPrReview({
    repoId,
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.html_url,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
  })

  // Start review workflow
  const workflowId = `review-${orgId}-${repoId}-${pr.number}-${pr.head.sha}`
  await container.workflowEngine.startWorkflow({
    workflowFn: "reviewPrWorkflow",
    workflowId,
    args: [{
      orgId,
      repoId,
      prNumber: pr.number,
      installationId,
      headSha: pr.head.sha,
      baseSha: pr.base.sha,
      owner,
      repo: repoName,
      reviewId: review.id,
    }],
    taskQueue: "light-llm-queue",
  })

  return { action: "review", workflowId }
}
