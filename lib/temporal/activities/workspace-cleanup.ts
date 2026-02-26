/**
 * Temporal activities for workspace cleanup.
 * Removes expired workspace overlays from ArangoDB and Supabase.
 */

import { type Container, getContainer } from "@/lib/di/container"

let _testContainer: Container | null = null

/** @internal — for unit tests only */
export function __setTestContainer(c: Container) { _testContainer = c }
export function __resetTestContainer() { _testContainer = null }

function resolveContainer(): Container {
  return _testContainer ?? getContainer()
}

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
