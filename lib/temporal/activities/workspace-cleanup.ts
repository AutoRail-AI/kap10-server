/**
 * Temporal activities for workspace cleanup.
 * Removes expired workspace overlays from ArangoDB and Supabase,
 * and cleans up workspace filesystem after indexing completes.
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

/** Base directory for workspace clones */
const WORKSPACE_BASE = "/data/workspaces"

/**
 * Clean up expired workspaces.
 * Removes overlay entities from ArangoDB and workspace rows from Supabase.
 * Returns the number of workspaces cleaned up.
 */
export async function cleanupExpiredWorkspacesActivity(): Promise<number> {
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
      console.error(`[WorkspaceCleanup] Failed to clean workspace ${workspace.id}:`, message)
    }
  }

  console.log(`[WorkspaceCleanup] Cleaned ${cleaned}/${expired.length} expired workspaces`)
  return cleaned
}

export interface CleanupWorkspaceFilesystemInput {
  orgId: string
  repoId: string
}

/**
 * K-01: Delete the cloned workspace directory from disk after indexing completes.
 * The workspace at /data/workspaces/{orgId}/{repoId} is only needed during
 * SCIP and tree-sitter parsing. Keeping it wastes disk on long-running workers.
 */
export async function cleanupWorkspaceFilesystem(input: CleanupWorkspaceFilesystemInput): Promise<void> {
  const log = logger.child({ service: "workspace-cleanup", organizationId: input.orgId, repoId: input.repoId })
  const workspacePath = join(WORKSPACE_BASE, input.orgId, input.repoId)

  if (!existsSync(workspacePath)) {
    log.info("Workspace directory already removed", { path: workspacePath })
    return
  }

  try {
    rmSync(workspacePath, { recursive: true, force: true })
    log.info("Workspace filesystem cleaned up", { path: workspacePath })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Failed to clean up workspace filesystem (non-fatal)", { path: workspacePath, error: message })
  }

  // Also try to remove the org directory if it's now empty
  try {
    const orgDir = join(WORKSPACE_BASE, input.orgId)
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
