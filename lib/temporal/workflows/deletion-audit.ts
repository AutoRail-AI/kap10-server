/**
 * P5.6-ADV-03: Deletion audit workflow for ephemeral sandbox cleanup.
 * Runs on a schedule, finds expired ephemeral repos, and cleans them up.
 */

import type { Container } from "@/lib/di/container"

const EPHEMERAL_TTL_HOURS = 4

export interface DeletionAuditInput {
  orgId: string
  repoId: string
}

/**
 * Activity: Check and clean up a single ephemeral repo.
 */
export async function cleanupEphemeralRepo(
  input: DeletionAuditInput,
  container: Container
): Promise<{ deleted: boolean; reason: string }> {
  const repo = await container.relationalStore.getRepo(input.orgId, input.repoId)
  if (!repo) {
    return { deleted: false, reason: "repo_not_found" }
  }

  if (!repo.ephemeral) {
    return { deleted: false, reason: "not_ephemeral" }
  }

  const expiresAt = repo.ephemeralExpiresAt
    ? new Date(repo.ephemeralExpiresAt)
    : new Date(repo.createdAt.getTime() + EPHEMERAL_TTL_HOURS * 60 * 60 * 1000)

  if (expiresAt > new Date()) {
    return { deleted: false, reason: "not_expired" }
  }

  // Clean up graph data
  await container.graphStore.deleteRepoData(input.orgId, input.repoId)

  // Delete the repo record
  await container.relationalStore.deleteRepo(input.repoId)

  return { deleted: true, reason: "expired" }
}

/**
 * Activity: Find all expired ephemeral repos across orgs.
 */
export async function findExpiredEphemeralRepos(
  _container: Container
): Promise<DeletionAuditInput[]> {
  // This would normally query across all orgs, but our relational store
  // is org-scoped. In production, this would be a direct Prisma query.
  // For now, return empty — the workflow caller should provide specific repos.
  return []
}

/**
 * Activity: Promote an ephemeral repo to permanent.
 */
export async function promoteEphemeralRepo(
  input: DeletionAuditInput,
  container: Container
): Promise<{ promoted: boolean }> {
  const repo = await container.relationalStore.getRepo(input.orgId, input.repoId)
  if (!repo) return { promoted: false }
  if (!repo.ephemeral) return { promoted: false }

  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: repo.status,
  })

  // In production we'd update ephemeral=false and clear ephemeralExpiresAt via Prisma
  // For now this is handled by the API route

  return { promoted: true }
}
