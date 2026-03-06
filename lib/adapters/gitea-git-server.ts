/**
 * GiteaGitServerAdapter — IInternalGitServer implementation.
 *
 * Two I/O channels:
 *   1. Gitea REST API (HTTP) — repo lifecycle: create mirror, sync, resolve refs.
 *      Gitea runs on the Docker internal network; never exposed publicly.
 *   2. Direct git CLI on shared volume — worktree operations.
 *      The heavy worker and Gitea share the same persistent volume, so
 *      `git worktree add` runs locally on the worker's filesystem.
 *
 * Why not 100% Gitea API? Because Gitea has no worktree API — worktrees are
 * a local git concept. And we want zero-network-hop SCIP indexing.
 */

import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

import type { GitChangedFile, IInternalGitServer, WorktreeHandle } from "@/lib/ports/internal-git-server"
import { logger } from "@/lib/utils/logger"

const execFileAsync = promisify(execFile)

/** Timeout for git CLI operations (2 minutes) */
const GIT_TIMEOUT_MS = 120_000
/** Timeout for Gitea HTTP API calls (30 seconds) */
const GITEA_API_TIMEOUT_MS = 30_000
/** Directory where ephemeral worktrees are created */
const WORKTREE_BASE_DIR = "/tmp/unerr-worktrees"
/** Max time to wait for Gitea's async mirror clone to complete */
const MIRROR_READY_TIMEOUT_MS = 180_000 // 3 minutes
/** Interval between mirror readiness checks */
const MIRROR_POLL_INTERVAL_MS = 2_000 // 2 seconds

const log = logger.child({ service: "gitea-git-server" })

// ─── Error Types ─────────────────────────────────────────────────────────────

export class GiteaUnavailableError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(`[GiteaGitServer] Gitea unavailable: ${message}`)
    this.name = "GiteaUnavailableError"
  }
}

export class GiteaAuthError extends Error {
  constructor(url: string) {
    super(`[GiteaGitServer] Authentication failed for ${url} — check GITEA_ADMIN_TOKEN`)
    this.name = "GiteaAuthError"
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getGiteaUrl(): string {
  const url = process.env.GITEA_URL
  if (!url) throw new Error("[GiteaGitServer] GITEA_URL env var is required")
  return url.replace(/\/$/, "") // strip trailing slash
}

function getGiteaToken(): string {
  const token = process.env.GITEA_ADMIN_TOKEN
  if (!token) throw new Error("[GiteaGitServer] GITEA_ADMIN_TOKEN env var is required")
  return token
}

function getDataDir(): string {
  return process.env.GITSERVER_DATA_DIR ?? "/data/repos"
}

/**
 * Build the path to the bare repo on the shared volume.
 * Gitea stores repos at: {REPOSITORY_ROOT}/{owner}/{repo}.git
 * We use orgId as the Gitea "owner" and repoId as the repo name.
 */
function bareRepoPath(orgId: string, repoId: string): string {
  return join(getDataDir(), orgId, `${repoId}.git`)
}

/**
 * Make a request to the Gitea REST API with proper auth and error handling.
 */
async function giteaFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const baseUrl = getGiteaUrl()
  const token = getGiteaToken()
  const url = `${baseUrl}/api/v1${path}`

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(GITEA_API_TIMEOUT_MS),
  })

  if (response.status === 401 || response.status === 403) {
    throw new GiteaAuthError(url)
  }

  if (response.status >= 500) {
    const body = await response.text().catch(() => "")
    throw new GiteaUnavailableError(`${response.status} ${response.statusText}: ${body}`, response.status)
  }

  return response
}

/**
 * Run a git command with timeout and structured error reporting.
 */
async function git(
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: options.cwd,
    timeout: options.timeout ?? GIT_TIMEOUT_MS,
    maxBuffer: 50 * 1024 * 1024, // 50 MB — large diffs can be verbose
    encoding: "utf-8",
  })
  return stdout.trim()
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class GiteaGitServerAdapter implements IInternalGitServer {

  async ensureCloned(orgId: string, repoId: string, cloneUrl: string): Promise<void> {
    // Check if Gitea already has this repo by querying the API
    const checkResp = await giteaFetch(`/repos/${orgId}/${repoId}`)

    if (checkResp.status === 200) {
      log.debug("Repo already exists in Gitea", { orgId, repoId })
      // Ensure webhook is configured (idempotent)
      await this.ensureWebhook(orgId, repoId)
      return
    }

    // Gitea needs the owner (org) to exist. Ensure it.
    await this.ensureGiteaOrg(orgId)

    // Create a mirror clone via Gitea's migration API.
    // This tells Gitea to `git clone --mirror` from the upstream URL.
    const resp = await giteaFetch("/repos/migrate", {
      method: "POST",
      body: JSON.stringify({
        clone_addr: cloneUrl,
        repo_name: repoId,
        repo_owner: orgId,
        mirror: true,
        service: "git",
        // Private: don't expose via Gitea's UI (which is disabled anyway)
        private: true,
      }),
    })

    if (!resp.ok && resp.status !== 409) {
      // 409 = repo already exists (race condition with concurrent indexing) — safe to ignore
      const body = await resp.text().catch(() => "")
      throw new Error(`[GiteaGitServer] Failed to create mirror: ${resp.status} ${body}`)
    }

    log.info("Created mirror clone in Gitea — waiting for async clone to complete", { orgId, repoId })

    // Gitea's /repos/migrate returns immediately (201) but runs `git clone --mirror`
    // asynchronously in the background. We must wait for it to finish before returning,
    // otherwise downstream callers (syncFromRemote → resolveRef) will get 404 on HEAD.
    await this.waitForMirrorReady(orgId, repoId)

    // Auto-create internal webhook for push events → /api/webhooks/gitea
    await this.ensureWebhook(orgId, repoId)
  }

  async syncFromRemote(orgId: string, repoId: string): Promise<string> {
    // Trigger Gitea's mirror sync — this does a `git fetch --prune` from origin
    const resp = await giteaFetch(`/repos/${orgId}/${repoId}/mirror-sync`, {
      method: "POST",
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => "")
      throw new Error(`[GiteaGitServer] Mirror sync failed: ${resp.status} ${body}`)
    }

    // mirror-sync is also async — give Gitea a moment, then resolve HEAD.
    // If HEAD fails (e.g. fetch still running), retry a few times with backoff.
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
      }
      try {
        return await this.resolveRef(orgId, repoId, "HEAD")
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error))
        log.debug("resolveRef retry after mirror-sync", { orgId, repoId, attempt, error: lastError.message })
      }
    }

    throw lastError!
  }

  async createWorktree(orgId: string, repoId: string, ref: string): Promise<WorktreeHandle> {
    const repoPath = bareRepoPath(orgId, repoId)
    if (!existsSync(repoPath)) {
      throw new Error(`[GiteaGitServer] Bare repo not found at ${repoPath} — call ensureCloned() first`)
    }

    // Create the worktree base dir if it doesn't exist
    mkdirSync(WORKTREE_BASE_DIR, { recursive: true })

    // Generate a unique worktree directory name
    const suffix = `${repoId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const worktreePath = join(WORKTREE_BASE_DIR, suffix)

    try {
      // --detach: don't create/track a branch, just check out at the ref
      await git(
        ["-C", repoPath, "worktree", "add", "--detach", worktreePath, ref],
        { cwd: repoPath }
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)

      // Check for ENOSPC (disk full) — surface it clearly
      if (message.includes("ENOSPC") || message.includes("No space left")) {
        throw new Error(`[GiteaGitServer] Disk full — cannot create worktree: ${message}`)
      }
      throw new Error(`[GiteaGitServer] Failed to create worktree at ${ref}: ${message}`)
    }

    // Resolve the actual commit SHA (ref might have been a branch name)
    const commitSha = await git(["rev-parse", "HEAD"], { cwd: worktreePath })

    log.info("Created worktree", { orgId, repoId, ref, commitSha, path: worktreePath })
    return { path: worktreePath, commitSha }
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    // Belt-and-suspenders: try git worktree remove first, then rm -rf.
    // Both are idempotent — safe to call even if already cleaned up.

    // Step 1: Try `git worktree remove --force`
    // We need to find the bare repo that owns this worktree. Parse from the
    // .git file inside the worktree (it contains a gitdir pointer).
    try {
      if (existsSync(worktreePath)) {
        // Find the parent bare repo from the worktree's .git file
        const gitFilePath = join(worktreePath, ".git")
        if (existsSync(gitFilePath)) {
          const { readFileSync } = require("node:fs") as typeof import("node:fs")
          const content = readFileSync(gitFilePath, "utf-8").trim()
          // Format: "gitdir: /data/repos/orgId/repoId.git/worktrees/suffix"
          const match = content.match(/gitdir:\s*(.+)/)
          if (match?.[1]) {
            // The bare repo is two levels up from the worktrees dir
            const bareRepo = join(match[1], "..", "..")
            try {
              await git(["-C", bareRepo, "worktree", "remove", "--force", worktreePath])
            } catch {
              // git worktree remove can fail if the metadata is already gone — that's fine
            }
          }
        }
      }
    } catch {
      // Non-critical: we'll rm -rf below regardless
    }

    // Step 2: Force-remove the directory
    try {
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true })
      }
    } catch (error: unknown) {
      // Log but don't throw — the GC cron will clean this up
      log.warn("Failed to rm -rf worktree (GC cron will handle it)", {
        worktreePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    log.debug("Removed worktree", { worktreePath })
  }

  async diffFiles(orgId: string, repoId: string, fromSha: string, toSha: string): Promise<GitChangedFile[]> {
    const repoPath = bareRepoPath(orgId, repoId)

    // --name-status gives us: M\tfile.ts, A\tnew.ts, D\told.ts, R100\told\tnew
    const output = await git(
      ["-C", repoPath, "diff", "--name-status", "--no-renames", fromSha, toSha],
      { cwd: repoPath }
    )

    if (!output) return []

    return output.split("\n").map((line) => {
      const [status, ...pathParts] = line.split("\t")
      const path = pathParts.join("\t") // handle filenames with tabs (unlikely but defensive)

      switch (status?.[0]) {
        case "A": return { path, changeType: "added" as const }
        case "D": return { path, changeType: "deleted" as const }
        case "M": return { path, changeType: "modified" as const }
        default:  return { path, changeType: "modified" as const }
      }
    }).filter((f) => f.path) // drop any empty lines
  }

  async resolveRef(orgId: string, repoId: string, ref: string): Promise<string> {
    const repoPath = bareRepoPath(orgId, repoId)

    // Prefer local git (faster, no network) if the bare repo is on the shared volume
    if (existsSync(repoPath)) {
      return git(["-C", repoPath, "rev-parse", ref])
    }

    // Fallback: Gitea API
    const resp = await giteaFetch(`/repos/${orgId}/${repoId}/git/refs/${ref}`)
    if (!resp.ok) {
      throw new Error(`[GiteaGitServer] Could not resolve ref '${ref}' in ${orgId}/${repoId}: ${resp.status}`)
    }
    const data = (await resp.json()) as { object?: { sha?: string }; [key: string]: unknown }
    const sha = data.object?.sha
    if (!sha) throw new Error(`[GiteaGitServer] No SHA in ref response for ${ref}`)
    return sha
  }

  async pushWorkspaceRef(orgId: string, repoId: string, userId: string, commitSha: string): Promise<void> {
    const repoPath = bareRepoPath(orgId, repoId)
    const refName = `refs/unerr/users/${userId}/workspace`

    // Direct git update-ref on the shared volume (no network hop)
    await git(["-C", repoPath, "update-ref", refName, commitSha])

    log.info("Updated workspace ref", { orgId, repoId, userId, commitSha, ref: refName })
  }

  async deleteRef(orgId: string, repoId: string, ref: string): Promise<void> {
    const repoPath = bareRepoPath(orgId, repoId)

    if (!existsSync(repoPath)) {
      // Repo doesn't exist on disk — nothing to delete
      log.debug("Skipping deleteRef: bare repo not found", { orgId, repoId, ref })
      return
    }

    try {
      // git update-ref -d deletes the ref. Exit code 1 if ref doesn't exist — that's fine.
      await git(["-C", repoPath, "update-ref", "-d", ref])
      log.info("Deleted ref", { orgId, repoId, ref })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      // "not a valid SHA1" or "could not delete" means the ref was already gone — idempotent
      if (msg.includes("not a valid") || msg.includes("could not delete")) {
        log.debug("Ref already absent", { orgId, repoId, ref })
        return
      }
      log.warn("Failed to delete ref (non-fatal)", { orgId, repoId, ref, error: msg })
    }
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Ensure a Gitea organization exists. Idempotent.
   * We use Gitea orgs to namespace repos by unerr orgId.
   */
  /**
   * Phase 13 (B-04): Create an internal webhook on the Gitea repo so push events
   * are forwarded to /api/webhooks/gitea. Idempotent — checks existing hooks first.
   */
  private async ensureWebhook(orgId: string, repoId: string): Promise<void> {
    // Determine the webhook target URL. In Docker, the Next.js app is reachable
    // at http://app:3000 (the Docker Compose service name). In dev, use localhost.
    const appUrl = process.env.APP_INTERNAL_URL ?? "http://localhost:3000"
    const hookUrl = `${appUrl}/api/webhooks/gitea`

    try {
      // Check if webhook already exists
      const listResp = await giteaFetch(`/repos/${orgId}/${repoId}/hooks`)
      if (listResp.ok) {
        const hooks = (await listResp.json()) as Array<{ config?: { url?: string } }>
        const exists = hooks.some((h) => h.config?.url === hookUrl)
        if (exists) {
          log.debug("Gitea webhook already exists", { orgId, repoId })
          return
        }
      }

      // Create webhook
      const secret = process.env.GITEA_WEBHOOK_SECRET ?? ""
      const resp = await giteaFetch(`/repos/${orgId}/${repoId}/hooks`, {
        method: "POST",
        body: JSON.stringify({
          type: "gitea",
          active: true,
          events: ["push"],
          config: {
            url: hookUrl,
            content_type: "json",
            secret,
          },
        }),
      })

      if (resp.ok || resp.status === 409) {
        log.info("Gitea webhook created", { orgId, repoId, hookUrl })
      } else {
        const body = await resp.text().catch(() => "")
        log.warn("Failed to create Gitea webhook (non-fatal)", { orgId, repoId, status: resp.status, body })
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn("Gitea webhook setup failed (non-fatal)", { orgId, repoId, error: msg })
    }
  }

  /**
   * Wait for Gitea's async mirror clone to finish.
   * Polls the repo API until `empty` becomes false (meaning refs exist).
   * Throws after MIRROR_READY_TIMEOUT_MS if the clone never completes.
   */
  private async waitForMirrorReady(orgId: string, repoId: string): Promise<void> {
    const deadline = Date.now() + MIRROR_READY_TIMEOUT_MS
    let lastStatus = "unknown"

    while (Date.now() < deadline) {
      try {
        const resp = await giteaFetch(`/repos/${orgId}/${repoId}`)
        if (resp.ok) {
          const repo = (await resp.json()) as { empty?: boolean; mirror?: boolean; status?: string; [key: string]: unknown }

          if (repo.empty === false) {
            log.info("Mirror clone ready", { orgId, repoId, waitedMs: MIRROR_READY_TIMEOUT_MS - (deadline - Date.now()) })
            return
          }
          lastStatus = repo.empty === true ? "empty (clone in progress)" : `status=${String(repo.status)}`
        } else {
          lastStatus = `HTTP ${resp.status}`
        }
      } catch (error: unknown) {
        lastStatus = error instanceof Error ? error.message : String(error)
      }

      await new Promise((resolve) => setTimeout(resolve, MIRROR_POLL_INTERVAL_MS))
    }

    throw new Error(
      `[GiteaGitServer] Mirror clone did not complete within ${MIRROR_READY_TIMEOUT_MS / 1000}s ` +
      `for ${orgId}/${repoId} (last status: ${lastStatus})`
    )
  }

  private async ensureGiteaOrg(orgId: string): Promise<void> {
    const check = await giteaFetch(`/orgs/${orgId}`)
    if (check.status === 200) return

    const resp = await giteaFetch("/orgs", {
      method: "POST",
      body: JSON.stringify({
        username: orgId,
        visibility: "private",
        // Gitea requires a full_name but we don't care about it
        full_name: orgId,
      }),
    })

    if (!resp.ok && resp.status !== 422) {
      // 422 = org already exists (race condition) — safe to ignore
      const body = await resp.text().catch(() => "")
      throw new Error(`[GiteaGitServer] Failed to create org: ${resp.status} ${body}`)
    }
  }
}
