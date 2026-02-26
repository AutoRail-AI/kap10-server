/**
 * Phase 5: Branch-aware shadow graph overlay.
 * Manages branch-scoped entity/edge variants for non-default branches.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

/**
 * Check if branch indexing is enabled and the branch matches the pattern.
 */
export function shouldIndexBranch(branch: string, defaultBranch: string): boolean {
  if (branch === defaultBranch) return true // Always index default branch

  const enabled = process.env.BRANCH_INDEXING_ENABLED === "true"
  if (!enabled) return false

  const pattern = process.env.BRANCH_INDEXING_PATTERN ?? "*"
  return matchBranchPattern(branch, pattern)
}

/**
 * Simple glob-style branch pattern matching.
 * Supports: * (any), prefix*, *suffix, exact match.
 */
function matchBranchPattern(branch: string, pattern: string): boolean {
  if (pattern === "*") return true

  const patterns = pattern.split(",").map((p) => p.trim())
  for (const p of patterns) {
    if (p === branch) return true
    if (p.endsWith("*") && branch.startsWith(p.slice(0, -1))) return true
    if (p.startsWith("*") && branch.endsWith(p.slice(1))) return true
  }

  return false
}

/**
 * Apply branch overlay to entities — prefix keys with branch name.
 * This creates shadow entities that don't conflict with the default branch.
 */
export function applyBranchOverlay(
  entities: EntityDoc[],
  branch: string,
  defaultBranch: string
): EntityDoc[] {
  if (branch === defaultBranch) return entities

  return entities.map((e) => ({
    ...e,
    id: `branch:${branch}:${e.id}`,
    _branch: branch,
    _base_entity_id: e.id,
  }))
}

/**
 * Apply branch overlay to edges.
 */
export function applyBranchEdgeOverlay(
  edges: EdgeDoc[],
  branch: string,
  defaultBranch: string
): EdgeDoc[] {
  if (branch === defaultBranch) return edges

  return edges.map((e) => ({
    ...e,
    _from: e._from.replace(/\/([^/]+)$/, `/branch:${branch}:$1`),
    _to: e._to.replace(/\/([^/]+)$/, `/branch:${branch}:$1`),
    _branch: branch,
  }))
}

/**
 * Resolve an entity query with branch context.
 * Checks branch overlay first, falls back to default branch.
 */
export async function resolveWithBranch(
  orgId: string,
  entityId: string,
  branch: string | undefined,
  defaultBranch: string,
  graphStore: IGraphStore
): Promise<EntityDoc | null> {
  if (branch && branch !== defaultBranch) {
    // Try branch overlay first
    const branchEntity = await graphStore.getEntity(orgId, `branch:${branch}:${entityId}`)
    if (branchEntity) return { ...branchEntity, id: entityId }
  }

  // Fall back to default branch
  return graphStore.getEntity(orgId, entityId)
}

/**
 * Clean up branch overlay entities when a branch is merged/deleted.
 */
export async function cleanupBranchOverlay(
  orgId: string,
  repoId: string,
  branch: string,
  graphStore: IGraphStore
): Promise<number> {
  // Get all entities for this repo with branch prefix
  const allEntities = await graphStore.getAllEntities(orgId, repoId)
  const branchEntities = allEntities.filter(
    (e) => (e._branch as string) === branch
  )

  if (branchEntities.length === 0) return 0

  const keys = branchEntities.map((e) => e.id)
  await graphStore.batchDeleteEdgesByEntity(orgId, keys)
  await graphStore.batchDeleteEntities(orgId, keys)

  return branchEntities.length
}
