/**
 * IInternalGitServer — Phase 13 port.
 *
 * Abstraction over the internal bare-repo Git server (Gitea in production,
 * in-memory maps for tests). Workers never talk to external Git hosts during
 * indexing — all code lives in bare clones managed by this port.
 *
 * Two I/O channels in the production adapter:
 *   1. Gitea REST API  — ensureCloned (mirror), syncFromRemote, resolveRef, pushWorkspaceRef
 *   2. Direct git CLI   — createWorktree, removeWorktree, diffFiles
 *      (workers share the Gitea data volume, so git runs locally on the same fs)
 */

// ─── Domain Types ────────────────────────────────────────────────────────────

/** A file changed between two commits (as reported by `git diff --name-status`) */
export interface GitChangedFile {
  path: string
  changeType: "added" | "modified" | "deleted" | "renamed"
  /** Only present for renames — the path the file was renamed from */
  oldPath?: string
}

/**
 * The universal "where does code come from" descriptor.
 * Replaces the old cloneUrl/installationId/uploadPath triple.
 * Every workflow and activity that touches source code receives this.
 */
export interface SourceSpec {
  orgId: string
  repoId: string
  /** Fully resolved commit SHA (40-char hex) */
  commitSha: string
  /** Git ref that was indexed, e.g. "refs/heads/main", "refs/unerr/users/{userId}/workspace" */
  ref: string
  /** For incremental indexing: the commit SHA of the previous index run */
  baseSha?: string
  /** Hint from the ingestion layer: which files changed (avoids a git diff in the heavy worker) */
  incrementalHint?: {
    changedFiles: string[]
  }
}

/** Result of creating a worktree — the caller's "handle" to a checked-out tree */
export interface WorktreeHandle {
  /** Absolute path to the worktree working directory (e.g. /tmp/unerr-worktrees/wt-abc123) */
  path: string
  /** The commit SHA the worktree is checked out at */
  commitSha: string
}

// ─── Port Interface ──────────────────────────────────────────────────────────

export interface IInternalGitServer {
  /**
   * Ensure a bare clone exists for this repo. Idempotent — if the repo already
   * exists on the gitserver, this is a no-op. If it doesn't, creates a mirror
   * clone from `cloneUrl`.
   *
   * @param cloneUrl — GitHub HTTPS clone URL (with installation token injected by the caller)
   */
  ensureCloned(orgId: string, repoId: string, cloneUrl: string): Promise<void>

  /**
   * Fetch the latest objects from the remote origin.
   * @returns The HEAD commit SHA after fetch.
   */
  syncFromRemote(orgId: string, repoId: string): Promise<string>

  /**
   * Create an ephemeral worktree checked out at `ref` (branch name, tag, or SHA).
   *
   * CRITICAL: The caller MUST call `removeWorktree()` in a `finally` block.
   * Failing to do so causes disk rot — orphaned worktrees accumulate and
   * eventually fill the volume. The GC cron (`pruneOrphanedWorktrees`) is a
   * safety net, not a substitute for proper cleanup.
   *
   * @returns A handle containing the worktree path and resolved commit SHA.
   */
  createWorktree(orgId: string, repoId: string, ref: string): Promise<WorktreeHandle>

  /**
   * Forcefully remove a worktree directory and its git metadata.
   * Safe to call even if the path doesn't exist (idempotent).
   * Performs both `git worktree remove --force` AND `rm -rf` as a belt-and-suspenders approach.
   */
  removeWorktree(worktreePath: string): Promise<void>

  /**
   * List files changed between two commits in a repo.
   * @returns Array of changed files with their change types.
   */
  diffFiles(orgId: string, repoId: string, fromSha: string, toSha: string): Promise<GitChangedFile[]>

  /**
   * Resolve a ref (branch name, tag, SHA prefix) to a full 40-char commit SHA.
   * @throws if the ref doesn't exist.
   */
  resolveRef(orgId: string, repoId: string, ref: string): Promise<string>

  /**
   * Create or update a per-user workspace ref pointing at a given commit SHA.
   * The ref lives at `refs/unerr/users/{userId}/workspace` inside the bare repo.
   */
  pushWorkspaceRef(orgId: string, repoId: string, userId: string, commitSha: string): Promise<void>

  /**
   * Delete a ref from the bare repo. Used during eviction to clean up stale
   * workspace refs (`refs/unerr/ws/{keyId}`) and branch refs.
   *
   * Idempotent: succeeds silently if the ref doesn't exist.
   */
  deleteRef(orgId: string, repoId: string, ref: string): Promise<void>
}
