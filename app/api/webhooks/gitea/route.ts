/**
 * Gitea internal webhook receiver — Phase 13 (B-04).
 *
 * Gitea sends a push event when the CLI pushes to refs/unerr/ws/{keyId}.
 * This webhook:
 *   1. Parses the push payload (ref, before/after SHA, changed files)
 *   2. Upserts a WorkspaceSync row in the relational store
 *   3. Triggers indexRepoWorkflow with scope="workspace:{keyId}"
 *
 * This endpoint is internal-only: Gitea → Unerr API on the Docker network.
 * No public access — Gitea webhook secret provides authenticity.
 */

import { NextResponse } from "next/server"
import { logger } from "@/lib/utils/logger"

const log = logger.child({ service: "gitea-webhook" })

/** Validate the Gitea webhook secret (X-Gitea-Signature header). */
function validateSignature(body: string, signature: string | null): boolean {
  if (!signature) return false
  const secret = process.env.GITEA_WEBHOOK_SECRET
  if (!secret) {
    // If no secret configured, skip validation (dev mode)
    log.warn("GITEA_WEBHOOK_SECRET not set — skipping signature validation")
    return true
  }

  const crypto = require("node:crypto") as typeof import("node:crypto")
  const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex")
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature))
}

/** Extract the workspace key ID from the ref. */
function parseWorkspaceRef(ref: string): string | null {
  // refs/unerr/ws/{keyId}
  const match = ref.match(/^refs\/unerr\/ws\/([a-f0-9]+)$/)
  return match ? match[1]! : null
}

interface GiteaPushPayload {
  ref: string
  before: string
  after: string
  repository: {
    name: string
    owner: { login: string }
  }
  commits?: Array<{
    id: string
    added?: string[]
    removed?: string[]
    modified?: string[]
  }>
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text()

  // Validate signature
  const signature = request.headers.get("x-gitea-signature")
  if (!validateSignature(rawBody, signature)) {
    log.warn("Invalid Gitea webhook signature")
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  // Parse payload
  let payload: GiteaPushPayload
  try {
    payload = JSON.parse(rawBody) as GiteaPushPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { ref, before, after, repository } = payload

  // Only process workspace refs
  const keyId = parseWorkspaceRef(ref)
  if (!keyId) {
    // Not a workspace push — could be a branch push, handle separately later (Sprint 5)
    log.info("Ignoring non-workspace push", { ref })
    return NextResponse.json({ ok: true, skipped: true })
  }

  // Extract org/repo from Gitea's repository metadata
  const orgId = repository.owner.login
  const repoId = repository.name

  // Count changed files from commits
  let fileCount = 0
  if (payload.commits) {
    const changedFiles = new Set<string>()
    for (const commit of payload.commits) {
      for (const f of commit.added ?? []) changedFiles.add(f)
      for (const f of commit.removed ?? []) changedFiles.add(f)
      for (const f of commit.modified ?? []) changedFiles.add(f)
    }
    fileCount = changedFiles.size
  }

  log.info("Workspace push received", { orgId, repoId, keyId, before: before.slice(0, 8), after: after.slice(0, 8), fileCount })

  try {
    // Upsert WorkspaceSync row
    const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
    const prisma = getPrisma()
    await prisma.workspaceSync.create({
      data: {
        orgId,
        repoId,
        userId: keyId, // keyId derived from API key hash — stable per-user identifier
        commitSha: after,
        baseSha: before === "0000000000000000000000000000000000000000" ? null : before,
        fileCount,
      },
    })
    log.info("WorkspaceSync row created", { orgId, repoId, keyId, commitSha: after.slice(0, 8) })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn("Failed to create WorkspaceSync row (non-fatal)", { error: msg })
    // Continue — triggering re-index is more important than the tracking row
  }

  // Trigger re-index with workspace scope
  try {
    const { getContainer } = require("@/lib/di/container") as typeof import("@/lib/di/container")
    const container = getContainer()

    // Look up the repo to get default branch
    const repo = await container.relationalStore.getRepo(orgId, repoId)
    if (!repo) {
      log.warn("Repo not found for workspace push", { repoId })
      return NextResponse.json({ error: "Repo not found" }, { status: 404 })
    }

    // Phase 13 (B-07): Use syncWorkspaceWorkflow for workspace pushes.
    // This is a lightweight workflow that computes the entity delta against
    // the primary scope and applies it — no full wipe/reindex.
    const workflowId = `sync-workspace-${orgId}-${repoId}-${keyId}-${Date.now()}`
    await container.workflowEngine.startWorkflow({
      workflowId,
      workflowFn: "syncWorkspaceWorkflow",
      taskQueue: "heavy-compute-queue",
      args: [{
        orgId,
        repoId,
        keyId,
        commitSha: after,
        baseSha: before === "0000000000000000000000000000000000000000" ? null : before,
      }],
    })

    log.info("Workspace re-index triggered", { orgId, repoId, keyId, workflowId })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error("Failed to trigger workspace re-index", undefined, { error: msg, orgId, repoId, keyId })
    return NextResponse.json({ error: "Failed to trigger re-index" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, orgId, repoId, keyId, commitSha: after })
}
