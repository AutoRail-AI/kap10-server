/**
 * sync_local_diff MCP tool — syncs uncommitted local changes to the cloud graph.
 * Creates/updates workspace overlay in ArangoDB with a Redis distributed lock.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"
import { filterDiff, parseDiffHunks } from "./diff-filter"

const MAX_DIFF_SIZE = 50 * 1024 // 50 KB after lockfile stripping
const LOCK_TTL = 30 // seconds
const LOCK_RETRIES = 3
const LOCK_RETRY_DELAY = 200 // ms

export const SYNC_LOCAL_DIFF_SCHEMA = {
  name: "sync_local_diff",
  description:
    "Sync your local uncommitted changes to the cloud knowledge graph. Provide the output of `git diff` and the tool will update entity information (function signatures, new functions, etc.) so subsequent tool calls reflect your latest code. Lockfiles and build artifacts are automatically excluded.",
  inputSchema: {
    type: "object" as const,
    properties: {
      diff: {
        type: "string",
        description: "Unified diff output (from `git diff`)",
      },
      branch: {
        type: "string",
        description: 'Current branch name (default: "main")',
      },
    },
    required: ["diff"],
  },
}

export async function handleSyncLocalDiff(
  args: { diff: string; branch?: string },
  ctx: McpAuthContext,
  container: Container
) {
  if (!ctx.userId) {
    return formatToolError(
      "sync_local_diff requires user context (OAuth authentication). API key mode does not support this tool without a user ID."
    )
  }

  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  if (!args.diff || args.diff.trim().length === 0) {
    return formatToolError("diff parameter is required and cannot be empty")
  }

  const branch = args.branch ?? "main"

  // Step 1: Filter lockfiles and build artifacts
  const { filtered, strippedFiles } = filterDiff(args.diff)

  // Step 2: Validate diff size after stripping
  const diffSizeBytes = Buffer.byteLength(filtered, "utf8")
  if (diffSizeBytes > MAX_DIFF_SIZE) {
    return formatToolError(
      `Diff too large (${Math.round(diffSizeBytes / 1024)}KB after lockfile exclusion). Maximum is ${MAX_DIFF_SIZE / 1024}KB. Try limiting your diff to specific files: git diff -- path/to/file.ts`
    )
  }

  if (filtered.trim().length === 0) {
    return formatToolResponse({
      status: "no_changes",
      message: "No code changes to sync (only lockfiles/build artifacts were in the diff)",
      strippedFiles,
    })
  }

  // Step 3: Acquire distributed lock
  const lockKey = `kap10:lock:workspace:${ctx.userId}:${repoId}:${branch}`
  let lockAcquired = false

  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    lockAcquired = await container.cacheStore.setIfNotExists(lockKey, "1", LOCK_TTL)
    if (lockAcquired) break
    if (attempt < LOCK_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY))
    }
  }

  if (!lockAcquired) {
    return formatToolError(
      "Workspace sync already in progress. Please wait and retry."
    )
  }

  try {
    // Step 4: Get or create workspace
    const ttlHours = parseInt(process.env.MCP_WORKSPACE_TTL_HOURS ?? "12", 10)
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000)

    let workspace = await container.relationalStore.getWorkspace(ctx.userId, repoId, branch)

    if (!workspace) {
      workspace = await container.relationalStore.createWorkspace({
        userId: ctx.userId,
        repoId,
        branch,
        expiresAt,
      })
    } else if (workspace.expiresAt < new Date()) {
      // Cold start: workspace expired, cleanup and recreate
      await container.graphStore.cleanupExpiredWorkspaces(workspace.id)
      workspace = await container.relationalStore.createWorkspace({
        userId: ctx.userId,
        repoId,
        branch,
        expiresAt,
      })
    } else {
      // Update sync timestamp and extend TTL
      await container.relationalStore.updateWorkspaceSync(workspace.id)
    }

    // Step 5: Parse diff hunks and identify affected entities
    const affectedFiles = parseDiffHunks(filtered)
    let entitiesUpdated = 0

    for (const file of affectedFiles) {
      // Get current entities in the file
      const entities = await container.graphStore.getEntitiesByFile(
        ctx.orgId,
        repoId,
        file.filePath
      )

      for (const entity of entities) {
        const entityLine = Number(entity.start_line) || 0
        const entityEndLine = Number(entity.end_line) || entityLine

        // Check if any hunk overlaps with this entity
        const isAffected = file.hunks.some((hunk) => {
          const hunkEnd = hunk.startLine + hunk.lineCount
          return entityLine <= hunkEnd && entityEndLine >= hunk.startLine
        })

        if (isAffected) {
          // Calculate line shift from hunks before this entity
          let lineShift = 0
          for (const hunk of file.hunks) {
            if (hunk.startLine < entityLine) {
              // Simplified: count added/removed lines
              lineShift += hunk.lineCount > 0 ? hunk.lineCount : 0
            }
          }

          // Upsert workspace overlay entity with shifted lines
          await container.graphStore.upsertWorkspaceEntity(
            ctx.orgId,
            workspace.id,
            {
              ...entity,
              start_line: entityLine + lineShift,
              end_line: entityEndLine + lineShift,
              _workspace_modified: true,
            }
          )
          entitiesUpdated++
        }
      }
    }

    return formatToolResponse({
      status: "synced",
      workspaceId: workspace.id,
      branch,
      filesAffected: affectedFiles.length,
      entitiesUpdated,
      strippedFiles: strippedFiles.length > 0 ? strippedFiles : undefined,
      expiresAt: expiresAt.toISOString(),
    })
  } finally {
    // Release lock
    await container.cacheStore.invalidate(lockKey)
  }
}
