/**
 * commit-graph — Phase 13 (C-02): Visible Uploads — nearest indexed commit lookup.
 *
 * When a query arrives for a commit that has no SCIP index, we need to find
 * the nearest ancestor that DOES have one. This module provides:
 *
 *   findNearestIndexedCommit(orgId, repoId, commitSha)
 *     → { nearestSha, distance } | null
 *
 * Strategy:
 *   1. Check NearestIndexedCommit cache (Prisma)
 *   2. If miss, walk `git rev-list` backward from commitSha on the bare repo
 *   3. For each batch of ancestor SHAs, check if a ScipIndex row exists
 *   4. Cache the result in NearestIndexedCommit table
 *
 * Runs on the shared Gitea volume — zero network I/O for git operations.
 */

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

import { logger } from "@/lib/utils/logger"

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 30_000

const log = logger.child({ service: "commit-graph" })

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NearestIndexedCommitResult {
  nearestSha: string
  distance: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDataDir(): string {
  return process.env.GITSERVER_DATA_DIR ?? "/data/repos"
}

function bareRepoPath(orgId: string, repoId: string): string {
  return join(getDataDir(), orgId, `${repoId}.git`)
}

/** Run a git command on the bare repo. Returns trimmed stdout. */
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout.trim()
}

// ─── Main Function ──────────────────────────────────────────────────────────

/** How many ancestor SHAs to fetch per batch from git rev-list */
const BATCH_SIZE = 50

/** Maximum ancestors to walk before giving up */
const MAX_WALK_DEPTH = 500

/**
 * Find the nearest ancestor commit that has a SCIP index.
 *
 * @returns The nearest indexed commit and its distance, or null if none found
 *          within MAX_WALK_DEPTH ancestors.
 */
export async function findNearestIndexedCommit(
  orgId: string,
  repoId: string,
  commitSha: string,
): Promise<NearestIndexedCommitResult | null> {
  const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
  const prisma = getPrisma()

  // Step 1: Check cache
  const cached = await prisma.nearestIndexedCommit.findUnique({
    where: { repoId_querySha: { repoId, querySha: commitSha } },
  })
  if (cached) {
    log.info("Cache hit for nearest indexed commit", {
      repoId,
      querySha: commitSha.slice(0, 8),
      nearestSha: cached.nearestSha.slice(0, 8),
      distance: cached.distance,
    })
    return { nearestSha: cached.nearestSha, distance: cached.distance }
  }

  // Step 2: Check if this commit itself has a SCIP index
  const selfIndex = await prisma.scipIndex.findFirst({
    where: { repoId, commitSha },
    select: { id: true },
  })
  if (selfIndex) {
    // Cache distance=0 and return
    await cacheResult(prisma, orgId, repoId, commitSha, commitSha, 0)
    return { nearestSha: commitSha, distance: 0 }
  }

  // Step 3: Walk git rev-list backward in batches
  const repoPath = bareRepoPath(orgId, repoId)
  if (!existsSync(repoPath)) {
    log.warn("Bare repo not found, cannot walk commit graph", { orgId, repoId, repoPath })
    return null
  }

  let offset = 0
  while (offset < MAX_WALK_DEPTH) {
    const batchSize = Math.min(BATCH_SIZE, MAX_WALK_DEPTH - offset)

    let ancestors: string[]
    try {
      // git rev-list: list ancestors starting from commitSha, skipping `offset`,
      // returning `batchSize` entries. --first-parent for linear walk (faster).
      const output = await git(
        ["-C", repoPath, "rev-list", "--first-parent", `--skip=${offset + 1}`, `--max-count=${batchSize}`, commitSha],
        repoPath,
      )
      if (!output) break
      ancestors = output.split("\n").filter(Boolean)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn("git rev-list failed", { orgId, repoId, commitSha: commitSha.slice(0, 8), error: msg })
      break
    }

    if (ancestors.length === 0) break

    // Batch query: which of these SHAs have a ScipIndex?
    const indexed = await prisma.scipIndex.findMany({
      where: { repoId, commitSha: { in: ancestors } },
      select: { commitSha: true },
    })

    if (indexed.length > 0) {
      // Find the closest one (earliest in the ancestors list = smallest distance)
      const indexedSet = new Set(indexed.map(r => r.commitSha))
      for (let i = 0; i < ancestors.length; i++) {
        if (indexedSet.has(ancestors[i]!)) {
          const nearestSha = ancestors[i]!
          const distance = offset + 1 + i // +1 because we skip the commit itself
          log.info("Found nearest indexed commit", {
            repoId,
            querySha: commitSha.slice(0, 8),
            nearestSha: nearestSha.slice(0, 8),
            distance,
          })
          await cacheResult(prisma, orgId, repoId, commitSha, nearestSha, distance)
          return { nearestSha, distance }
        }
      }
    }

    offset += ancestors.length
  }

  log.info("No indexed ancestor found within walk depth", {
    repoId,
    querySha: commitSha.slice(0, 8),
    maxDepth: MAX_WALK_DEPTH,
  })
  return null
}

/**
 * Bulk-populate NearestIndexedCommit cache for all reachable commits from a
 * newly indexed commit. Called by the commit-graph pre-computation activity.
 *
 * Strategy: Walk forward from the indexed commit (all children in the DAG)
 * and for each commit that doesn't already have a cache entry, set this
 * indexed commit as the nearest if it's closer than any existing entry.
 *
 * V1 simplification: Only updates the cache for direct descendants (linear
 * segments). Full DAG traversal deferred to V2.
 */
export async function preComputeNearestIndexed(
  orgId: string,
  repoId: string,
  indexedSha: string,
): Promise<number> {
  const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
  const prisma = getPrisma()

  const repoPath = bareRepoPath(orgId, repoId)
  if (!existsSync(repoPath)) {
    log.warn("Bare repo not found for pre-computation", { orgId, repoId })
    return 0
  }

  // Get all commits that are descendants of indexedSha (commits that have
  // indexedSha as an ancestor). We use `git rev-list` to get commits between
  // indexedSha and HEAD, which are the ones that might benefit from this cache.
  let descendants: string[]
  try {
    const output = await git(
      ["-C", repoPath, "rev-list", "--first-parent", `--max-count=${MAX_WALK_DEPTH}`, `${indexedSha}..HEAD`],
      repoPath,
    )
    if (!output) return 0
    descendants = output.split("\n").filter(Boolean)
  } catch {
    // If this fails (e.g., indexedSha IS HEAD), that's fine — nothing to precompute
    return 0
  }

  // For each descendant, cache indexedSha as the nearest indexed commit
  // (only if no closer one already exists)
  let updated = 0
  for (let i = 0; i < descendants.length; i++) {
    const querySha = descendants[i]!
    const distance = descendants.length - i // descendants are returned newest-first

    try {
      // Upsert: only update if the new distance is smaller
      const existing = await prisma.nearestIndexedCommit.findUnique({
        where: { repoId_querySha: { repoId, querySha } },
        select: { distance: true },
      })

      if (!existing || existing.distance > distance) {
        await prisma.nearestIndexedCommit.upsert({
          where: { repoId_querySha: { repoId, querySha } },
          create: { orgId, repoId, querySha, nearestSha: indexedSha, distance },
          update: { nearestSha: indexedSha, distance },
        })
        updated++
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn("Failed to cache nearest indexed commit (non-fatal)", { querySha: querySha.slice(0, 8), error: msg })
    }
  }

  log.info("Pre-computed nearest indexed commits", {
    orgId,
    repoId,
    indexedSha: indexedSha.slice(0, 8),
    descendantsScanned: descendants.length,
    updated,
  })

  return updated
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

async function cacheResult(
  prisma: ReturnType<typeof import("@/lib/db/prisma").getPrisma>,
  orgId: string,
  repoId: string,
  querySha: string,
  nearestSha: string,
  distance: number,
): Promise<void> {
  try {
    await prisma.nearestIndexedCommit.upsert({
      where: { repoId_querySha: { repoId, querySha } },
      create: { orgId, repoId, querySha, nearestSha, distance },
      update: { nearestSha, distance },
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn("Failed to cache nearest indexed commit (non-fatal)", { querySha: querySha.slice(0, 8), error: msg })
  }
}
