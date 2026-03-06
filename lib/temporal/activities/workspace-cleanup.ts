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
