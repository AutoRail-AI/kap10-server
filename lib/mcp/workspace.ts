/**
 * Workspace resolution — per-user, per-repo, per-branch workspace management.
 * Resolves the current workspace context for MCP tool calls.
 */

import type { Container } from "@/lib/di/container"
import type { WorkspaceRecord } from "@/lib/ports/relational-store"

/**
 * Resolve the active workspace for a user/repo/branch combination.
 * Returns null if no workspace exists or the workspace has expired.
 */
export async function resolveWorkspace(
  userId: string,
  repoId: string,
  branch: string,
  container: Container
): Promise<WorkspaceRecord | null> {
  const workspace = await container.relationalStore.getWorkspace(userId, repoId, branch)

  if (!workspace) return null

  // Check if expired
  if (workspace.expiresAt < new Date()) {
    return null // Caller should handle cold-start
  }

  return workspace
}

/**
 * Get the workspace ID for use in entity overlay queries.
 * Returns undefined if no active workspace, meaning queries use committed data only.
 */
export async function getWorkspaceId(
  userId: string | undefined,
  repoId: string,
  branch: string | undefined,
  container: Container
): Promise<string | undefined> {
  if (!userId || !branch) return undefined

  const workspace = await resolveWorkspace(userId, repoId, branch, container)
  return workspace?.id
}
