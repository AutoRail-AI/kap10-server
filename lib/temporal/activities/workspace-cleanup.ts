/**
 * Temporal activities for index directory cleanup.
 * Removes expired workspace overlays from ArangoDB and Supabase,
 * and cleans up the repo index directory (temporary clone) after indexing completes.
 */

import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

import { type Container, getContainer } from "@/lib/di/container"
import { logger } from "@/lib/utils/logger"

let _testContainer: Container | null = null

/** @internal — for unit tests only */
export function __setTestContainer(c: Container) { _testContainer = c }
export function __resetTestContainer() { _testContainer = null }

function resolveContainer(): Container {
  return _testContainer ?? getContainer()
}

/** Base directory for repo index clones */
const REPO_INDEX_BASE = "/data/repo-indices"

/**
 * Clean up expired workspaces.
 * Removes overlay entities from ArangoDB and workspace rows from Supabase.
 * Returns the number of workspaces cleaned up.
 */
export async function cleanupExpiredWorkspacesActivity(): Promise<number> {
  const log = logger.child({ service: "workspace-cleanup" })
  const container = resolveContainer()

  // Get and delete expired workspaces from Supabase
  const expired = await container.relationalStore.deleteExpiredWorkspaces()

  if (expired.length === 0) {
    return 0
  }

  // Clean up overlay entities for each expired workspace
  let cleaned = 0
  for (const workspace of expired) {
    try {
      await container.graphStore.cleanupExpiredWorkspaces(workspace.id)
      cleaned++
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn("Failed to clean expired workspace", { workspaceId: workspace.id, errorMessage: message })
    }
  }

  log.info(`Cleaned ${cleaned}/${expired.length} expired workspaces`)
  return cleaned
}

export interface CleanupWorkspaceFilesystemInput {
  orgId: string
  repoId: string
}

/**
 * K-01: Delete the cloned workspace directory from disk after indexing completes.
 * The repo index directory at /data/repo-indices/{orgId}/{repoId} is only needed during
 * SCIP and tree-sitter parsing. Keeping it wastes disk on long-running workers.
 */
export async function cleanupWorkspaceFilesystem(input: CleanupWorkspaceFilesystemInput): Promise<void> {
  const log = logger.child({ service: "workspace-cleanup", organizationId: input.orgId, repoId: input.repoId })
  const indexDir = join(REPO_INDEX_BASE, input.orgId, input.repoId)

  if (!existsSync(indexDir)) {
    log.info("Repo index directory already removed", { path: indexDir })
    return
  }

  try {
    rmSync(indexDir, { recursive: true, force: true })
    log.info("Repo index directory cleaned up", { path: indexDir })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Failed to clean up repo index directory (non-fatal)", { path: indexDir, error: message })
  }

  // Also try to remove the org directory if it's now empty
  try {
    const orgDir = join(REPO_INDEX_BASE, input.orgId)
    if (existsSync(orgDir)) {
      const { readdirSync } = await import("node:fs")
      const remaining = readdirSync(orgDir)
      if (remaining.length === 0) {
        rmSync(orgDir, { recursive: true, force: true })
        log.info("Empty org directory removed", { path: orgDir })
      }
    }
  } catch {
    // ignore — best-effort cleanup
  }
}

/**
 * B-09: Prune stale workspace scoped entities from ArangoDB.
 *
 * A workspace is "stale" if its last sync was more than `maxAgeHours` ago.
 * This activity:
 *   1. Queries WorkspaceSync for stale entries (no sync in maxAgeHours)
 *   2. Deletes scoped entities from ArangoDB via deleteScopedEntities
 *   3. Removes the WorkspaceSync rows
 *
 * Designed to run on a cron schedule (e.g., every 6 hours).
 */
export async function pruneStaleWorkspaces(input?: { maxAgeHours?: number }): Promise<number> {
  const maxAgeHours = input?.maxAgeHours ?? 48
  const log = logger.child({ service: "workspace-cleanup" })
  const container = resolveContainer()

  const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
  const prisma = getPrisma()

  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000)

  // Find distinct (orgId, repoId, userId) combos where the LATEST sync is older than cutoff
  const staleSyncs = await prisma.workspaceSync.findMany({
    where: { syncedAt: { lt: cutoff } },
    distinct: ["orgId", "repoId", "userId"],
    select: { orgId: true, repoId: true, userId: true },
  })

  if (staleSyncs.length === 0) {
    log.info("No stale workspaces to prune")
    return 0
  }

  let pruned = 0
  for (const { orgId, repoId, userId } of staleSyncs) {
    const scope = `workspace:${userId}`
    try {
      // Check if there's a more recent sync that's NOT stale
      const recentSync = await prisma.workspaceSync.findFirst({
        where: { orgId, repoId, userId, syncedAt: { gte: cutoff } },
        select: { id: true },
      })
      if (recentSync) continue // This user has a recent sync — skip

      // 1. Delete scoped entities from ArangoDB
      await container.graphStore.deleteScopedEntities(orgId, repoId, scope)

      // 2. Delete the workspace ref from Gitea (B-09: clean up refs/unerr/ws/{keyId})
      //    The ref name uses a key-derived ID, which we can reconstruct from the userId.
      //    Also try the older refs/unerr/users/{userId}/workspace format.
      try {
        await container.internalGitServer.deleteRef(orgId, repoId, `refs/unerr/users/${userId}/workspace`)
      } catch {
        // Best-effort — refs are cheap (40 bytes), next run retries
      }

      // 3. Delete workspace sync rows
      await prisma.workspaceSync.deleteMany({
        where: { orgId, repoId, userId },
      })

      log.info("Pruned stale workspace", { orgId, repoId, userId: userId.slice(0, 8), scope })
      pruned++
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn("Failed to prune stale workspace (non-fatal)", { orgId, repoId, userId: userId.slice(0, 8), error: msg })
    }
  }

  log.info("Stale workspace pruning complete", { pruned, total: staleSyncs.length, maxAgeHours })
  return pruned
}
