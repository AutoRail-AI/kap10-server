/**
 * ingestSource — Phase 13 ingestion gateway activity.
 *
 * Normalizes all code ingestion paths into the internal bare git object store
 * (Gitea). After this activity completes, the bare clone exists and the
 * commitSha is resolved — downstream activities use createWorktree() on the
 * shared volume, never touching external Git hosts.
 *
 * Runs on light-llm-queue (network-bound, not CPU-bound).
 */

import { getContainer } from "@/lib/di/container"
import type { PipelineContext } from "@/lib/temporal/activities/pipeline-logs"
import { pipelineLogger } from "@/lib/temporal/activities/pipeline-logs"
import { logger } from "@/lib/utils/logger"

export interface IngestSourceInput extends PipelineContext {
  provider: "github" | "local_cli"
  /** GitHub repos: installation ID for fetching clone tokens */
  installationId?: number
  /** GitHub repos: clone URL (e.g., https://github.com/acme/app.git) */
  cloneUrl?: string
  /** Default branch name (e.g., "main") */
  defaultBranch?: string
}

export interface IngestSourceResult {
  /** Fully resolved 40-char commit SHA */
  commitSha: string
  /** Git ref that was ingested (e.g., "refs/heads/main") */
  ref: string
}

/**
 * Ensure a bare clone exists on the internal gitserver and sync it to the
 * latest remote state. Returns the resolved commit SHA and ref.
 *
 * GitHub repos: calls ensureCloned() + syncFromRemote() via Gitea mirror API.
 * Local CLI repos: the CLI has already pushed via the Git proxy route, so we
 * just need to resolve the HEAD ref.
 */
export async function ingestSource(input: IngestSourceInput): Promise<IngestSourceResult> {
  const log = logger.child({ service: "ingest-source", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "indexing")
  const start = Date.now()

  const container = getContainer()
  const gitServer = container.internalGitServer
  const defaultBranch = input.defaultBranch ?? "main"
  const ref = `refs/heads/${defaultBranch}`

  if (input.provider === "github") {
    if (!input.cloneUrl) {
      throw new Error("[ingestSource] GitHub provider requires cloneUrl")
    }

    // Step 1: Inject the installation token into the clone URL so Gitea can
    // authenticate against GitHub when mirroring.
    let authenticatedUrl = input.cloneUrl
    if (input.installationId) {
      try {
        const token = await container.gitHost.getInstallationToken(input.installationId)
        // Replace https://github.com/ with https://x-access-token:{token}@github.com/
        authenticatedUrl = input.cloneUrl.replace(
          "https://github.com/",
          `https://x-access-token:${token}@github.com/`
        )
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        log.warn("Failed to get installation token, using unauthenticated URL", { error: msg })
        // Fall through — public repos don't need auth
      }
    }

    // Step 2: Ensure the bare clone exists on Gitea (idempotent — no-op if already mirrored)
    plog.log("info", "Step 0/7", "Ensuring bare clone exists on internal gitserver...")
    await gitServer.ensureCloned(input.orgId, input.repoId, authenticatedUrl)

    // Step 3: Sync from remote (git fetch) to pick up latest commits
    plog.log("info", "Step 0/7", "Syncing from remote origin...")
    const commitSha = await gitServer.syncFromRemote(input.orgId, input.repoId)

    const durationMs = Date.now() - start
    log.info("GitHub source ingested", { commitSha, ref, durationMs })
    plog.log("info", "Step 0/7", `Source ingested from GitHub — ${commitSha.slice(0, 8)} (${durationMs}ms)`)
    return { commitSha, ref }
  }

  if (input.provider === "local_cli") {
    // For local CLI repos, the code has already been pushed to Gitea via the
    // Git proxy route. We just resolve the current HEAD.
    plog.log("info", "Step 0/7", "Resolving HEAD for CLI-pushed repo...")

    // Phase 13 (B-04): Ensure Gitea webhook is configured for push notifications.
    // For CLI repos the repo was auto-created by Gitea on first git push, but we
    // still need the webhook. ensureCloned is idempotent — returns early if repo exists.
    try {
      await gitServer.ensureCloned(input.orgId, input.repoId, `local://${input.repoId}`)
    } catch {
      // Non-critical — webhook setup failure doesn't block indexing
    }

    const commitSha = await gitServer.resolveRef(input.orgId, input.repoId, "HEAD")
    const durationMs = Date.now() - start
    log.info("CLI source resolved", { commitSha, ref, durationMs })
    plog.log("info", "Step 0/7", `CLI source resolved — ${commitSha.slice(0, 8)} (${durationMs}ms)`)
    return { commitSha, ref }
  }

  throw new Error(`[ingestSource] Unknown provider: ${input.provider}`)
}
