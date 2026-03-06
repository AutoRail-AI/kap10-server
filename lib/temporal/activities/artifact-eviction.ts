/**
 * Artifact eviction activities — Phase 13 (A-17, B-09).
 *
 * Two independent eviction activities:
 *   1. SCIP index artifacts: Supabase Storage files + Prisma ScipIndex rows + orphaned NearestIndexedCommit
 *   2. Stale branch refs: Prisma BranchRef + ArangoDB scoped entities + Gitea refs
 *
 * Retention policy (from Phase 13 arch doc Section 9):
 *   - Latest primary SCIP index per repo: FOREVER (never evicted)
 *   - Older primary SCIP indexes: 30 days after creation
 *   - Workspace SCIP indexes: 7 days after last sync
 *   - Branch SCIP indexes: 30 days after branch ref becomes stale
 *
 * Design: Each artifact is evicted individually with try/catch so a single failure
 * doesn't block the rest. The daily schedule means any transient failure retries
 * within 24 hours. All operations are idempotent.
 */

import { Context } from "@temporalio/activity"

import { type Container, getContainer } from "@/lib/di/container"
import { logger } from "@/lib/utils/logger"

let _testContainer: Container | null = null
export function __setTestContainer(c: Container) { _testContainer = c }
export function __resetTestContainer() { _testContainer = null }
function resolveContainer(): Container {
  return _testContainer ?? getContainer()
}

const SCIP_BUCKET = "scip-indexes"

// ── Types ────────────────────────────────────────────────────────────────────

export interface EvictScipArtifactsInput {
  primaryRetentionDays?: number   // default: 30
  workspaceRetentionDays?: number // default: 7
  dryRun?: boolean
}

export interface EvictStaleBranchRefsInput {
  staleAfterDays?: number // default: 30
  dryRun?: boolean
}

// ── Activity 1: SCIP artifact eviction ───────────────────────────────────────

/**
 * Evict expired SCIP index artifacts from Supabase Storage and Prisma.
 *
 * Algorithm:
 *   1. For each repo, find the LATEST ScipIndex (kept forever).
 *   2. Delete all other ScipIndex rows older than `primaryRetentionDays`.
 *      For each deleted row, also delete the .scip.gz from Supabase Storage.
 *   3. Delete orphaned NearestIndexedCommit rows whose `nearestSha` no longer
 *      has a matching ScipIndex — done as a single set-based query, not N+1.
 */
export async function evictStaleScipArtifacts(
  input?: EvictScipArtifactsInput,
): Promise<{ deleted: number; storageDeleted: number; nearestCommitsDeleted: number; errors: number }> {
  const retentionDays = input?.primaryRetentionDays ?? 30
  const dryRun = input?.dryRun ?? false

  const log = logger.child({ service: "artifact-eviction", phase: "scip", dryRun })
  const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
  const prisma = getPrisma()
  const container = resolveContainer()

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

  let deleted = 0
  let storageDeleted = 0
  let nearestCommitsDeleted = 0
  let errors = 0

  // ── Step 1: Evict old SCIP indexes (keeping the latest per repo) ──────

  // Get distinct repos that have at least one SCIP index
  const repoIds = await prisma.scipIndex.findMany({
    distinct: ["repoId"],
    select: { repoId: true },
  })

  for (const { repoId } of repoIds) {
    Context.current().heartbeat(`scip:repo:${repoId}`)
    try {
      // Find the SINGLE latest index for this repo — this is NEVER evicted
      const latest = await prisma.scipIndex.findFirst({
        where: { repoId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })

      if (!latest) continue // impossible given the query above, but defensive

      // Find all indexes for this repo that are:
      //   - older than the retention cutoff
      //   - NOT the latest one
      const candidates = await prisma.scipIndex.findMany({
        where: {
          repoId,
          createdAt: { lt: cutoff },
          id: { not: latest.id },
        },
        select: { id: true, storagePath: true, commitSha: true },
      })

      for (const idx of candidates) {
        // Delete the storage file first (less critical if this fails — we can retry)
        try {
          if (!dryRun) {
            await container.storageProvider.deleteFile(SCIP_BUCKET, idx.storagePath)
            storageDeleted++
          }
        } catch (err: unknown) {
          // File may already be gone (previous partial eviction) — log and continue
          const msg = err instanceof Error ? err.message : String(err)
          log.warn("Storage file deletion failed (non-fatal)", { path: idx.storagePath, error: msg })
          errors++
        }

        // Delete the Prisma row (this is the authoritative record)
        try {
          if (!dryRun) {
            await prisma.scipIndex.delete({ where: { id: idx.id } })
          }
          deleted++
          log.info("Evicted SCIP index", { repoId, sha: idx.commitSha.slice(0, 8), dryRun })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          log.warn("Prisma ScipIndex deletion failed", { id: idx.id, error: msg })
          errors++
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn("Error processing repo for SCIP eviction", { repoId, error: msg })
      errors++
    }
  }

  // ── Step 2: Clean orphaned NearestIndexedCommit rows (set-based) ──────
  //
  // Instead of N+1 queries, we:
  //   1. Collect the set of all valid (repoId, commitSha) pairs from ScipIndex
  //   2. Find NearestIndexedCommit rows whose nearestSha is NOT in that set
  //   3. Batch-delete them
  //
  // For repos with many entries, we process in chunks to avoid memory pressure.

  try {
    // Get all valid (repoId, nearestSha) combos from the SCIP index table
    const validIndexes = await prisma.scipIndex.findMany({
      select: { repoId: true, commitSha: true },
    })
    // Build a Set for O(1) lookup: "repoId:commitSha"
    const validSet = new Set(validIndexes.map((i) => `${i.repoId}:${i.commitSha}`))

    // Fetch all NearestIndexedCommit rows in batches and check membership
    const BATCH_SIZE = 1000
    let skip = 0
    let hasMore = true

    while (hasMore) {
      Context.current().heartbeat(`scip:nic:batch:${skip}`)
      const batch = await prisma.nearestIndexedCommit.findMany({
        select: { id: true, repoId: true, nearestSha: true },
        take: BATCH_SIZE,
        skip,
        orderBy: { id: "asc" },
      })

      if (batch.length < BATCH_SIZE) hasMore = false

      const orphanIds = batch
        .filter((nic) => !validSet.has(`${nic.repoId}:${nic.nearestSha}`))
        .map((nic) => nic.id)

      if (orphanIds.length > 0 && !dryRun) {
        const result = await prisma.nearestIndexedCommit.deleteMany({
          where: { id: { in: orphanIds } },
        })
        nearestCommitsDeleted += result.count
      } else if (orphanIds.length > 0) {
        nearestCommitsDeleted += orphanIds.length
      }

      skip += BATCH_SIZE
    }

    if (nearestCommitsDeleted > 0) {
      log.info("Cleaned orphaned NearestIndexedCommit rows", { count: nearestCommitsDeleted, dryRun })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn("Error cleaning NearestIndexedCommit orphans", { error: msg })
    errors++
  }

  log.info("SCIP artifact eviction complete", { deleted, storageDeleted, nearestCommitsDeleted, errors })
  return { deleted, storageDeleted, nearestCommitsDeleted, errors }
}

// ── Activity 2: Branch ref eviction ──────────────────────────────────────────

/**
 * Evict stale branch refs and all their associated data:
 *   1. ArangoDB scoped entities (scope = "branch:{name}")
 *   2. Gitea ref (on the bare repo)
 *   3. Prisma BranchRef row
 *
 * A branch is "stale" when:
 *   - It was never indexed AND is older than `staleAfterDays`, OR
 *   - Its last indexing was more than `staleAfterDays` ago
 */
export async function evictStaleBranchRefs(
  input?: EvictStaleBranchRefsInput,
): Promise<{ branchRefsDeleted: number; scopedEntitiesDeleted: number; errors: number }> {
  const staleAfterDays = input?.staleAfterDays ?? 30
  const dryRun = input?.dryRun ?? false

  const log = logger.child({ service: "artifact-eviction", phase: "branches", dryRun })
  const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
  const prisma = getPrisma()
  const container = resolveContainer()

  const cutoff = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1000)

  let branchRefsDeleted = 0
  let scopedEntitiesDeleted = 0
  let errors = 0

  const staleBranches = await prisma.branchRef.findMany({
    where: {
      OR: [
        { lastIndexedAt: null, createdAt: { lt: cutoff } },
        { lastIndexedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, orgId: true, repoId: true, branchName: true },
  })

  if (staleBranches.length === 0) {
    log.info("No stale branch refs found")
    return { branchRefsDeleted: 0, scopedEntitiesDeleted: 0, errors: 0 }
  }

  log.info("Found stale branch refs to evict", { count: staleBranches.length })

  for (const branch of staleBranches) {
    Context.current().heartbeat(`branch:${branch.branchName}`)
    const scope = `branch:${branch.branchName}`
    try {
      if (!dryRun) {
        // 1. Delete scoped entities from ArangoDB
        const entitiesDeleted = await container.graphStore.deleteScopedEntities(
          branch.orgId,
          branch.repoId,
          scope,
        )
        scopedEntitiesDeleted += entitiesDeleted

        // 2. Delete the git ref from Gitea (idempotent — no-op if already gone)
        try {
          await container.internalGitServer.deleteRef(
            branch.orgId,
            branch.repoId,
            `refs/heads/${branch.branchName}`,
          )
        } catch (err: unknown) {
          // Gitea ref deletion is best-effort — refs are cheap
          const msg = err instanceof Error ? err.message : String(err)
          log.warn("Gitea ref deletion failed (non-fatal)", { branch: branch.branchName, error: msg })
        }

        // 3. Delete the BranchRef Prisma row
        await prisma.branchRef.delete({ where: { id: branch.id } })
      }

      branchRefsDeleted++
      log.info("Evicted stale branch", {
        orgId: branch.orgId,
        repoId: branch.repoId,
        branch: branch.branchName,
        dryRun,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn("Failed to evict branch ref (non-fatal)", {
        branch: branch.branchName,
        repoId: branch.repoId,
        error: msg,
      })
      errors++
    }
  }

  log.info("Branch ref eviction complete", { branchRefsDeleted, scopedEntitiesDeleted, errors })
  return { branchRefsDeleted, scopedEntitiesDeleted, errors }
}
