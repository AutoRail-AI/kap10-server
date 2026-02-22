/**
 * Diff analyzer — parses GitHub diffs and maps changed lines to ArangoDB entities.
 * Reuses filterDiff() and parseDiffHunks() from diff-filter.ts.
 */

import { filterDiff, parseDiffHunks } from "@/lib/mcp/tools/diff-filter"
import type { IGraphStore } from "@/lib/ports/graph-store"
import type { EntityDoc } from "@/lib/ports/types"

export interface DiffFile {
  filePath: string
  hunks: Array<{ startLine: number; lineCount: number }>
}

export interface DiffAnalysisResult {
  files: DiffFile[]
  strippedFiles: string[]
  affectedEntities: Array<EntityDoc & { changedLines: Array<{ start: number; end: number }> }>
}

/**
 * Parse a unified diff, filter lockfiles/build artifacts, and map to entities.
 */
export async function analyzeDiff(
  diff: string,
  orgId: string,
  repoId: string,
  graphStore: IGraphStore
): Promise<DiffAnalysisResult> {
  // Step 1: Filter lockfiles and build artifacts
  const { filtered, strippedFiles } = filterDiff(diff)

  // Step 2: Parse into per-file hunks
  const files = parseDiffHunks(filtered)

  // Step 3: Map changed lines to ArangoDB entities
  const affectedEntities: DiffAnalysisResult["affectedEntities"] = []

  for (const file of files) {
    // Skip deleted files (no entities to map)
    if (file.hunks.length === 0) continue

    const entities = await graphStore.getEntitiesByFile(orgId, repoId, file.filePath)

    for (const entity of entities) {
      const entityStart = Number(entity.start_line) || 0
      const entityEnd = Number(entity.end_line) || entityStart

      // Check if any hunk overlaps with entity line range
      const overlappingHunks: Array<{ start: number; end: number }> = []
      for (const hunk of file.hunks) {
        const hunkEnd = hunk.startLine + hunk.lineCount - 1
        // Lines overlap if hunk range intersects entity range
        if (hunk.startLine <= entityEnd && hunkEnd >= entityStart) {
          overlappingHunks.push({ start: hunk.startLine, end: hunkEnd })
        }
      }

      if (overlappingHunks.length > 0) {
        affectedEntities.push({ ...entity, changedLines: overlappingHunks })
      }
    }
  }

  return { files, strippedFiles, affectedEntities }
}

/**
 * Check if a specific line is within the changed ranges of a diff file.
 */
export function isLineInChangedRange(files: DiffFile[], filePath: string, line: number): boolean {
  const file = files.find((f) => f.filePath === filePath)
  if (!file) return false
  return file.hunks.some((h) => line >= h.startLine && line < h.startLine + h.lineCount)
}
