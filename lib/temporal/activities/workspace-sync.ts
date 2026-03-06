/**
 * workspace-sync — Phase 13 (B-08): Activities for incremental workspace re-indexing.
 *
 * These activities power the syncWorkspaceWorkflow, which is a lighter-weight
 * alternative to the full indexRepoWorkflow. Instead of wiping all graph data
 * and re-indexing from scratch, it:
 *   1. Diffs the changed files between base and new commits
 *   2. Runs SCIP + tree-sitter on the full worktree (V1 — no partial SCIP yet)
 *   3. Computes the entity delta against the base (primary) entities
 *   4. Applies the delta as scoped entities in ArangoDB
 *
 * V1 simplification: We re-index the full worktree but only WRITE the delta.
 * This means SCIP runs on all files (fast enough at 15-45s for most repos),
 * but only changed/added/deleted entities get scoped writes. This avoids the
 * complexity of partial SCIP merge (B-06, deferred to Sprint 8/V2).
 *
 * Runs on heavy-compute-queue (SCIP indexing is CPU-bound).
 */

import { heartbeat } from "@temporalio/activity"

import { getContainer } from "@/lib/di/container"
import { computeEntityDelta } from "@/lib/indexer/incremental-merge"
import type { GitChangedFile } from "@/lib/ports/internal-git-server"
import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import { logger } from "@/lib/utils/logger"

// ─── Activity Inputs/Outputs ─────────────────────────────────────────────────

export interface WorkspaceDiffInput {
  orgId: string
  repoId: string
  baseSha: string
  newSha: string
}

export interface WorkspaceDiffResult {
  changedFiles: GitChangedFile[]
  totalChanged: number
}

export interface WorkspaceReindexInput {
  orgId: string
  repoId: string
  /** The new commit to index */
  commitSha: string
  /** Workspace scope identifier (e.g., "workspace:abc123def456") */
  scope: string
  /** Previous commit SHA — if null, this is the first sync (full delta) */
  baseSha: string | null
}

export interface WorkspaceReindexResult {
  entitiesWritten: number
  tombstonesCreated: number
  edgesWritten: number
}

// ─── Activities ──────────────────────────────────────────────────────────────

/**
 * Compute the list of changed files between two commits using git diff.
 * Runs on the Gitea shared volume — zero network I/O.
 */
export async function workspaceDiff(input: WorkspaceDiffInput): Promise<WorkspaceDiffResult> {
  const log = logger.child({ service: "workspace-sync", organizationId: input.orgId, repoId: input.repoId })
  const start = Date.now()

  const container = getContainer()
  const changedFiles = await container.internalGitServer.diffFiles(
    input.orgId,
    input.repoId,
    input.baseSha,
    input.newSha,
  )

  const durationMs = Date.now() - start
  log.info("Workspace diff computed", {
    baseSha: input.baseSha.slice(0, 8),
    newSha: input.newSha.slice(0, 8),
    totalChanged: changedFiles.length,
    durationMs,
  })

  return { changedFiles, totalChanged: changedFiles.length }
}

/**
 * Full re-index of a workspace commit with delta application.
 *
 * Strategy (V1):
 *   1. Create worktree at new commit
 *   2. Run full SCIP + tree-sitter (produces all entities for the worktree)
 *   3. Load primary (base) entities from ArangoDB
 *   4. Compute entity delta (added/modified/deleted vs primary)
 *   5. Apply delta as scoped entities via applyBranchDelta
 *   6. Clean up worktree in finally{}
 *
 * Why full re-index instead of partial SCIP (B-06)?
 * Partial SCIP merge is complex and error-prone. SCIP indexing the full
 * worktree takes 15-45s for most repos. We accept this cost in V1 and
 * defer partial SCIP to V2 (Phase 13f) when we have real performance data.
 */
export async function workspaceReindex(input: WorkspaceReindexInput): Promise<WorkspaceReindexResult> {
  const log = logger.child({ service: "workspace-sync", organizationId: input.orgId, repoId: input.repoId })
  const activityStart = Date.now()

  const container = getContainer()
  let worktreePath: string | null = null

  try {
    // Step 1: Create worktree at the new commit
    heartbeat("creating worktree")
    const worktreeStart = Date.now()
    const handle = await container.internalGitServer.createWorktree(
      input.orgId, input.repoId, input.commitSha
    )
    worktreePath = handle.path
    const worktreeMs = Date.now() - worktreeStart
    log.info("Worktree created for workspace sync", {
      path: handle.path, commitSha: handle.commitSha, durationMs: worktreeMs,
    })

    // Step 2: Run SCIP + tree-sitter on the full worktree
    // We reuse the existing heavy indexing activities but collect entities
    // into memory instead of writing directly to ArangoDB.
    heartbeat("running SCIP indexers")
    const indexStart = Date.now()
    const { entities: branchEntities, edges: branchEdges } = await indexWorktree(
      container, input.orgId, input.repoId, handle.path, input.scope, input.commitSha,
    )
    const indexMs = Date.now() - indexStart
    log.info("Workspace indexing complete", {
      entityCount: branchEntities.length,
      edgeCount: branchEdges.length,
      durationMs: indexMs,
    })

    // Step 3: Load primary (base) entities for delta computation
    heartbeat("loading primary entities for delta")
    const deltaStart = Date.now()
    const baseEntities = await container.graphStore.getAllEntities(input.orgId, input.repoId, 50_000)
    const baseEdges = await container.graphStore.getAllEdges(input.orgId, input.repoId, 100_000)

    // Filter to primary scope only (exclude any existing workspace/branch entities)
    const primaryEntities = baseEntities.filter(e => !e.scope || e.scope === "primary")
    const primaryEdges = baseEdges.filter(e => !e.scope || e.scope === "primary")

    // Step 4: Compute entity delta
    heartbeat("computing entity delta")
    const delta = computeEntityDelta(primaryEntities, branchEntities, primaryEdges, branchEdges)
    const deltaMs = Date.now() - deltaStart
    log.info("Entity delta computed", {
      added: delta.added.length,
      modified: delta.modified.length,
      deleted: delta.deletedKeys.length,
      addedEdges: delta.addedEdges.length,
      deletedEdges: delta.deletedEdgeKeys.length,
      durationMs: deltaMs,
    })

    // Step 5: Apply the delta as scoped entities
    heartbeat("applying branch delta")
    const applyStart = Date.now()
    const result = await container.graphStore.applyBranchDelta(
      input.orgId, input.repoId, input.scope, delta,
    )
    const applyMs = Date.now() - applyStart
    log.info("Workspace delta applied", {
      entitiesWritten: result.entitiesWritten,
      tombstonesCreated: result.tombstonesCreated,
      edgesWritten: result.edgesWritten,
      durationMs: applyMs,
    })

    const totalMs = Date.now() - activityStart
    log.info("Workspace reindex complete", {
      scope: input.scope,
      commitSha: input.commitSha.slice(0, 8),
      totalMs,
      timing: { worktreeMs, indexMs, deltaMs, applyMs },
    })

    return {
      entitiesWritten: result.entitiesWritten,
      tombstonesCreated: result.tombstonesCreated,
      edgesWritten: result.edgesWritten,
    }
  } finally {
    // Worktree cleanup — CRITICAL: must run even on failure
    if (worktreePath) {
      try {
        await container.internalGitServer.removeWorktree(worktreePath)
        log.info("Worktree removed", { path: worktreePath })
      } catch (cleanupErr: unknown) {
        const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
        log.warn("Worktree cleanup failed (GC cron will handle)", { path: worktreePath, error: msg })
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Index a worktree using the existing SCIP + tree-sitter pipeline,
 * collecting entities and edges in memory instead of writing to ArangoDB.
 *
 * This reuses the scanner, language plugins, and SCIP decoder — the same
 * code path as indexRepoWorkflow — but returns entities instead of persisting.
 */
async function indexWorktree(
  container: ReturnType<typeof getContainer>,
  orgId: string,
  repoId: string,
  indexDir: string,
  scope: string,
  commitSha: string,
): Promise<{ entities: EntityDoc[]; edges: EdgeDoc[] }> {
  // Dynamically import indexer modules to avoid loading them at module scope
  // (these are heavy and only needed inside the activity)
  const { scanIndexDir, detectLanguages } = require("@/lib/indexer/scanner") as typeof import("@/lib/indexer/scanner")
  const { initializeRegistry, getPluginsForExtensions, getPluginForExtension } = require("@/lib/indexer/languages/registry") as typeof import("@/lib/indexer/languages/registry")
  const { detectPackageRoots } = require("@/lib/indexer/monorepo") as typeof import("@/lib/indexer/monorepo")
  const { loadIgnoreFilter } = require("@/lib/indexer/ignore") as typeof import("@/lib/indexer/ignore")
  const { entityHash, edgeHash } = require("@/lib/indexer/entity-hash") as typeof import("@/lib/indexer/entity-hash")
  const { readFileWithEncoding } = require("@/lib/indexer/file-reader") as typeof import("@/lib/indexer/file-reader")
  const { createFileEntity } = require("@/lib/indexer/languages/generic") as typeof import("@/lib/indexer/languages/generic")
  const { statSync } = require("node:fs") as typeof import("node:fs")

  await initializeRegistry()

  const files = await scanIndexDir(indexDir)
  const languageStats = detectLanguages(files)
  const languages = languageStats.map(l => l.language)
  const extensions = Array.from(new Set(files.map(f => f.extension)))
  const plugins = getPluginsForExtensions(extensions)
  const indexInfo = detectPackageRoots(indexDir)
  const isIncluded = loadIgnoreFilter(indexDir)

  const allEntities: EntityDoc[] = []
  const allEdges: EdgeDoc[] = []
  const coveredFiles: string[] = []

  // Run SCIP indexers
  for (const plugin of plugins) {
    try {
      heartbeat(`SCIP ${plugin.id}`)
      const result = await plugin.runSCIP({
        indexDir,
        packageRoots: indexInfo.roots,
        orgId,
        repoId,
        isIncluded,
      })

      for (const e of result.entities) {
        allEntities.push({
          id: e.id || entityHash(repoId, e.file_path, e.kind, e.name, e.signature),
          org_id: orgId,
          repo_id: repoId,
          kind: e.kind,
          name: e.name,
          file_path: e.file_path,
          start_line: e.start_line,
          end_line: e.end_line,
          language: e.language,
          signature: e.signature,
          scope,
          commit_sha: commitSha,
        })
      }
      for (const e of result.edges) {
        allEdges.push({
          _from: e.from_id,
          _to: e.to_id,
          org_id: orgId,
          repo_id: repoId,
          kind: e.kind,
          _key: edgeHash(e.from_id, e.to_id, e.kind),
          scope,
          commit_sha: commitSha,
        })
      }
      coveredFiles.push(...result.coveredFiles)
    } catch {
      // SCIP plugin failure is non-fatal — tree-sitter fallback below
    }
  }

  // Tree-sitter fallback for uncovered files
  const coveredSet = new Set(coveredFiles)
  const MAX_FILE_SIZE = 1 * 1024 * 1024

  // Create file entities for all files
  for (const file of files) {
    const fileEntity = createFileEntity(repoId, file.relativePath)
    allEntities.push({
      id: fileEntity.id || entityHash(repoId, file.relativePath, "file", file.relativePath),
      org_id: orgId,
      repo_id: repoId,
      kind: "file",
      name: file.relativePath.split("/").pop() ?? file.relativePath,
      file_path: file.relativePath,
      scope,
      commit_sha: commitSha,
    })
  }

  // Parse uncovered files with tree-sitter
  const uncoveredFiles = files.filter(f => !coveredSet.has(f.relativePath))
  for (const file of uncoveredFiles) {
    const plugin = getPluginForExtension(file.extension)
    if (!plugin) continue

    try {
      const fileStat = statSync(file.absolutePath)
      if (fileStat.size > MAX_FILE_SIZE) continue

      const fileResult = readFileWithEncoding(file.absolutePath)
      if (!fileResult) continue

      const result = await plugin.parseWithTreeSitter({
        filePath: file.relativePath,
        content: fileResult.content,
        orgId,
        repoId,
      })

      for (const e of result.entities) {
        allEntities.push({
          id: e.id || entityHash(repoId, e.file_path, e.kind, e.name, e.signature),
          org_id: orgId,
          repo_id: repoId,
          kind: e.kind,
          name: e.name,
          file_path: e.file_path,
          start_line: e.start_line,
          end_line: e.end_line,
          language: e.language,
          scope,
          commit_sha: commitSha,
        })
      }
      for (const e of result.edges) {
        allEdges.push({
          _from: e.from_id,
          _to: e.to_id,
          org_id: orgId,
          repo_id: repoId,
          kind: e.kind,
          _key: edgeHash(e.from_id, e.to_id, e.kind),
          scope,
          commit_sha: commitSha,
        })
      }
    } catch {
      // Non-critical — skip unparseable files
    }
  }

  // Deduplicate by ID
  const entityMap = new Map<string, EntityDoc>()
  for (const e of allEntities) entityMap.set(e.id, e)
  const edgeMap = new Map<string, EdgeDoc>()
  for (const e of allEdges) edgeMap.set(`${e._from}:${e._to}:${e.kind}`, e)

  return {
    entities: Array.from(entityMap.values()),
    edges: Array.from(edgeMap.values()),
  }
}
