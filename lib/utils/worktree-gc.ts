/**
 * Worktree Garbage Collection — Phase 13 disk rot prevention.
 *
 * Problem: If a Temporal activity crashes (OOM, timeout, worker restart) while
 * a git worktree is checked out, the directory is left on disk. The bare repo
 * still tracks it, preventing `git gc` from reclaiming space. Over time, the
 * worker's SSD fills up with orphaned worktrees.
 *
 * Solution (defense in depth):
 *   1. Every activity wraps worktree usage in try/finally (primary defense)
 *   2. This GC function runs on worker startup and every 30 minutes (safety net)
 *   3. Docker healthcheck can monitor /tmp/unerr-worktrees disk usage
 *
 * The GC is intentionally aggressive: any worktree directory older than
 * MAX_WORKTREE_AGE_MS is forcefully removed. SCIP indexing of even the largest
 * repos takes < 10 minutes, so a 2-hour TTL is extremely conservative.
 */

import { execFile } from "node:child_process"
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

import { logger } from "@/lib/utils/logger"

const execFileAsync = promisify(execFile)
const log = logger.child({ service: "worktree-gc" })

/** Worktrees older than this are considered orphaned and will be deleted */
const MAX_WORKTREE_AGE_MS = 2 * 60 * 60 * 1000 // 2 hours

/** Directory where all ephemeral worktrees are created */
const WORKTREE_BASE_DIR = "/tmp/unerr-worktrees"

/** How often the GC interval fires (30 minutes) */
const GC_INTERVAL_MS = 30 * 60 * 1000

/**
 * Prune orphaned worktrees from disk and git metadata.
 *
 * Safe to call concurrently — each operation is idempotent.
 * Safe to call when no worktrees exist — it's a no-op.
 */
export async function pruneOrphanedWorktrees(): Promise<{ pruned: number; errors: number }> {
  let pruned = 0
  let errors = 0

  // Phase 1: rm -rf any worktree directory older than MAX_WORKTREE_AGE_MS
  if (existsSync(WORKTREE_BASE_DIR)) {
    const now = Date.now()
    let entries: string[]
    try {
      entries = readdirSync(WORKTREE_BASE_DIR)
    } catch (error: unknown) {
      log.warn("Failed to read worktree base dir", {
        dir: WORKTREE_BASE_DIR,
        error: error instanceof Error ? error.message : String(error),
      })
      return { pruned: 0, errors: 1 }
    }

    for (const entry of entries) {
      const worktreePath = join(WORKTREE_BASE_DIR, entry)
      try {
        const stat = statSync(worktreePath)
        const ageMs = now - stat.mtimeMs

        if (ageMs > MAX_WORKTREE_AGE_MS) {
          rmSync(worktreePath, { recursive: true, force: true })
          pruned++
          log.info("Pruned orphaned worktree", {
            path: worktreePath,
            ageMinutes: Math.round(ageMs / 60_000),
          })
        }
      } catch (error: unknown) {
        errors++
        log.warn("Failed to prune worktree", {
          path: worktreePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  // Phase 2: Run `git worktree prune` on all bare repos to clean up stale metadata.
  // This removes entries from .git/worktrees/ that point to directories that no longer exist.
  const dataDir = process.env.GITSERVER_DATA_DIR ?? "/data/repos"
  if (existsSync(dataDir)) {
    try {
      const orgs = readdirSync(dataDir)
      for (const org of orgs) {
        const orgDir = join(dataDir, org)
        // Skip non-directories (e.g., gitea.db)
        try {
          if (!statSync(orgDir).isDirectory()) continue
        } catch { continue }

        let repos: string[]
        try {
          repos = readdirSync(orgDir)
        } catch { continue }

        for (const repo of repos) {
          if (!repo.endsWith(".git")) continue
          const repoPath = join(orgDir, repo)
          try {
            await execFileAsync("git", ["-C", repoPath, "worktree", "prune"], {
              timeout: 10_000,
            })
          } catch (error: unknown) {
            // Non-critical: this just cleans up metadata
            log.debug("git worktree prune failed (non-critical)", {
              repoPath,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }
    } catch (error: unknown) {
      log.warn("Failed to iterate bare repos for worktree prune", {
        dataDir,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (pruned > 0 || errors > 0) {
    log.info("Worktree GC complete", { pruned, errors })
  }

  return { pruned, errors }
}

/**
 * Start the worktree GC interval. Call once on worker startup.
 * Returns a cleanup function to stop the interval (for graceful shutdown).
 */
export function startWorktreeGC(): () => void {
  // Run immediately on startup to clean up anything left from a previous crash
  pruneOrphanedWorktrees().catch((error: unknown) => {
    log.error("Worktree GC startup run failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  })

  // Then run every GC_INTERVAL_MS
  const interval = setInterval(() => {
    pruneOrphanedWorktrees().catch((error: unknown) => {
      log.error("Worktree GC interval run failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, GC_INTERVAL_MS)

  return () => clearInterval(interval)
}
