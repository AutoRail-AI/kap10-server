/**
 * Diff filter — strips lockfile and build artifact hunks from diffs.
 * These contain no meaningful code structure for the knowledge graph.
 */
import { ALWAYS_IGNORE } from "@/lib/indexer/ignore"

const LOCKFILE_PATTERNS = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Gemfile.lock",
  "poetry.lock",
  "Cargo.lock",
  "go.sum",
  "composer.lock",
  "Pipfile.lock",
  "bun.lockb",
]

/**
 * Check if a file path matches lockfile or build artifact patterns.
 * Uses the shared ALWAYS_IGNORE set for directory exclusion.
 */
function isExcludedPath(filePath: string): boolean {
  for (const lockfile of LOCKFILE_PATTERNS) {
    if (filePath.endsWith(lockfile) || filePath === lockfile) return true
  }
  // Check path segments against ALWAYS_IGNORE
  const segments = filePath.split("/")
  for (const segment of segments) {
    if (ALWAYS_IGNORE.has(segment)) return true
  }
  return false
}

/**
 * Parse a unified diff and strip hunks from lockfiles and build artifacts.
 * Returns the filtered diff string and metadata about what was stripped.
 */
export function filterDiff(diff: string): { filtered: string; strippedFiles: string[] } {
  const lines = diff.split("\n")
  const outputLines: string[] = []
  const strippedFiles: string[] = []

  let currentFile = ""
  let isExcluded = false

  for (const line of lines) {
    // Detect file header: diff --git a/path b/path
    if (line.startsWith("diff --git")) {
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/)
      if (match) {
        currentFile = match[2] ?? match[1] ?? ""
        isExcluded = isExcludedPath(currentFile)
        if (isExcluded && !strippedFiles.includes(currentFile)) {
          strippedFiles.push(currentFile)
        }
      }
    }

    // Also detect --- a/path and +++ b/path headers
    if (line.startsWith("--- a/") || line.startsWith("+++ b/")) {
      const path = line.slice(6)
      if (isExcludedPath(path)) {
        isExcluded = true
        if (!strippedFiles.includes(path)) {
          strippedFiles.push(path)
        }
      }
    }

    if (!isExcluded) {
      outputLines.push(line)
    }
  }

  return {
    filtered: outputLines.join("\n"),
    strippedFiles,
  }
}

/**
 * Parse a unified diff to extract affected files and line ranges.
 */
export function parseDiffHunks(diff: string): Array<{
  filePath: string
  hunks: Array<{ startLine: number; lineCount: number }>
}> {
  const lines = diff.split("\n")
  const files: Array<{
    filePath: string
    hunks: Array<{ startLine: number; lineCount: number }>
  }> = []

  let currentFile = ""

  for (const line of lines) {
    // Detect file: +++ b/path
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6)
      files.push({ filePath: currentFile, hunks: [] })
      continue
    }

    // Detect hunk header: @@ -old,count +new,count @@
    if (line.startsWith("@@") && currentFile) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
      if (match) {
        const startLine = parseInt(match[1]!, 10)
        const lineCount = match[2] ? parseInt(match[2], 10) : 1
        const file = files[files.length - 1]
        if (file) {
          file.hunks.push({ startLine, lineCount })
        }
      }
    }
  }

  return files
}
