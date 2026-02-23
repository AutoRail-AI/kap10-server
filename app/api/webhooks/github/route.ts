import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"
import { handlePullRequestEvent, type PullRequestPayload } from "@/lib/github/webhook-handlers/pull-request"
import { logger } from "@/lib/utils/logger"

const WEBHOOK_DEDUPE_TTL = 86400

interface PushPayload {
  ref: string
  before: string
  after: string
  repository: {
    id: number
    full_name: string
    default_branch: string
    clone_url: string
  }
  installation?: { id: number }
  head_commit?: { message: string }
  commits?: Array<{ message: string }>
  action?: string
}

const log = logger.child({ service: "webhook" })

export async function POST(req: NextRequest) {
  const delivery = req.headers.get("x-github-delivery")
  const signature = req.headers.get("x-hub-signature-256")
  const event = req.headers.get("x-github-event")

  if (!delivery || !signature) {
    log.warn("Missing required headers", { delivery, event })
    return NextResponse.json({ error: "Missing headers" }, { status: 401 })
  }

  log.info(`Received GitHub webhook`, { event, delivery })

  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    log.error("Webhook secret not configured")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
  }

  const raw = await req.text()
  const crypto = await import("node:crypto")
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex")
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    log.warn("Invalid webhook signature", { delivery, event })
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const container = getContainer()
  const dedupeKey = `webhook:gh:${delivery}`
  const set = await container.cacheStore.setIfNotExists(dedupeKey, "1", WEBHOOK_DEDUPE_TTL)
  if (!set) {
    log.info("Duplicate webhook delivery, skipping", { delivery, event })
    return NextResponse.json({ ok: true })
  }

  let payload: PushPayload & { action?: string; installation?: { id: number } }
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    log.warn("Invalid JSON payload", { delivery, event })
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Handle installation deletion
  if (event === "installation" && payload.action === "deleted" && payload.installation?.id) {
    log.info("Processing installation deletion", { installationId: payload.installation.id })
    const inst = await container.relationalStore.getInstallationByInstallationId(payload.installation.id)
    if (inst) {
      await container.relationalStore.deleteInstallationById(inst.id)
      log.info("Installation deleted", { installationId: payload.installation.id, organizationId: inst.organizationId })
    }
  }

  // Phase 5: Handle push events for incremental indexing
  if (event === "push" && payload.ref && payload.repository) {
    try {
      log.info("Processing push event", {
        repoFullName: payload.repository.full_name,
        ref: payload.ref,
        afterSha: payload.after?.slice(0, 8),
      })
      await handlePushEvent(payload, container)
    } catch (error: unknown) {
      log.error("Push handler error", error instanceof Error ? error : undefined, {
        repoFullName: payload.repository.full_name,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      // Don't fail the webhook response — log and continue
    }
  }

  // Phase 7: Handle pull_request events for PR review
  if (event === "pull_request") {
    try {
      log.info("Processing pull_request event", {
        action: payload.action,
        repoFullName: payload.repository?.full_name,
      })
      await handlePullRequestEvent(payload as unknown as PullRequestPayload, container)
    } catch (error: unknown) {
      log.error("Pull request handler error", error instanceof Error ? error : undefined, {
        action: payload.action,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    }
  }

  log.info("Webhook processed", { event, delivery })
  return NextResponse.json({ ok: true })
}

async function handlePushEvent(
  payload: PushPayload,
  container: Awaited<ReturnType<typeof getContainer>>
) {
  const installationId = payload.installation?.id
  if (!installationId) return

  // Only handle pushes to the default branch
  const branchRef = `refs/heads/${payload.repository.default_branch}`
  if (payload.ref !== branchRef) {
    log.info("Ignoring push to non-default branch", { ref: payload.ref, defaultBranch: payload.repository.default_branch })
    return
  }

  // Resolve org + repo from installation + GitHub repo ID
  const installation = await container.relationalStore.getInstallationByInstallationId(installationId)
  if (!installation) {
    log.warn("Push from unknown installation", { installationId })
    return
  }

  const repo = await container.relationalStore.getRepoByGithubId(
    installation.organizationId,
    payload.repository.id
  )
  if (!repo) {
    log.info("Push for untracked repo, ignoring", { installationId, githubRepoId: payload.repository.id })
    return
  }

  const orgId = installation.organizationId
  const repoId = repo.id
  const pushLog = log.child({ organizationId: orgId, repoId })

  // Guard: repo must be in "ready" status and have incremental enabled
  if (repo.status !== "ready") {
    pushLog.info("Ignoring push: repo not in ready state", { currentStatus: repo.status })
    return
  }
  // Check incrementalEnabled (defaults to true if not set)
  if ((repo as { incrementalEnabled?: boolean }).incrementalEnabled === false) {
    pushLog.info("Ignoring push: incremental indexing disabled")
    return
  }

  // Guard: if before SHA is all zeros, this is a new branch creation — skip
  if (payload.before === "0000000000000000000000000000000000000000") {
    pushLog.info("Ignoring push: new branch creation")
    return
  }

  // Guard: SHA gap detection — if lastIndexedSha doesn't match before, trigger full re-index
  const lastSha = repo.lastIndexedSha
  if (lastSha && lastSha !== payload.before) {
    pushLog.warn("SHA gap detected, triggering full re-index", {
      lastIndexedSha: lastSha?.slice(0, 8),
      pushBeforeSha: payload.before?.slice(0, 8),
    })
    await container.workflowEngine.startWorkflow({
      workflowFn: "indexRepoWorkflow",
      workflowId: `reindex-${orgId}-${repoId}-${Date.now()}`,
      args: [{
        orgId,
        repoId,
        installationId,
        cloneUrl: payload.repository.clone_url,
        defaultBranch: payload.repository.default_branch,
      }],
      taskQueue: "heavy-compute-queue",
    })
    return
  }

  // Build workspace path (same pattern as index-repo)
  const os = await import("node:os")
  const path = await import("node:path")
  const workspacePath = path.join(os.tmpdir(), "kap10-workspaces", orgId, repoId)

  const commitMessage = payload.head_commit?.message
    ?? payload.commits?.[0]?.message
    ?? ""

  // Use signalWithStart pattern: fixed workflow ID per repo
  const workflowId = `incremental-${orgId}-${repoId}`
  try {
    pushLog.info("Starting incremental index workflow", { workflowId, afterSha: payload.after?.slice(0, 8) })
    await container.workflowEngine.startWorkflow({
      workflowFn: "incrementalIndexWorkflow",
      workflowId,
      args: [{
        orgId,
        repoId,
        installationId,
        cloneUrl: payload.repository.clone_url,
        defaultBranch: payload.repository.default_branch,
        workspacePath,
        initialPush: {
          afterSha: payload.after,
          beforeSha: payload.before,
          ref: payload.ref,
          commitMessage,
        },
      }],
      taskQueue: "heavy-compute-queue",
    })
  } catch (error: unknown) {
    // If workflow already running, send signal instead
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("already started") || message.includes("already running")) {
      pushLog.info("Incremental workflow already running, sending signal", { workflowId })
      await container.workflowEngine.signalWorkflow(workflowId, "push", {
        afterSha: payload.after,
        beforeSha: payload.before,
        ref: payload.ref,
        commitMessage,
      })
    } else {
      throw error
    }
  }
}
