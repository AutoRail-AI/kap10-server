/**
 * File discovery for repo index directory scanning.
 *
 * Walks the repo index directory (a temporary clone at /data/repo-indices/{org}/{repo}),
 * respects .gitignore patterns, and returns files with extension-based language detection.
 */
import { execFile } from "node:child_process"
import { extname, join, resolve } from "node:path"
import { promisify } from "node:util"

import { loadIgnoreFilter } from "./ignore"
import type { LanguageDetection, ScannedFile } from "./types"

const execFileAsync = promisify(execFile)

/** Extension → language mapping */
const EXTENSION_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".scala": "scala",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".sql": "sql",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
}

/**
 * Scan a repo index directory for source files.
 * Uses `git ls-files` when inside a git repo (respects .gitignore automatically),
 * falls back to manual walk if git is unavailable.
 */
export async function scanIndexDir(indexDir: string): Promise<ScannedFile[]> {
  const absRoot = resolve(indexDir)

  // Check if directory exists
  try {
    const { statSync } = require("node:fs") as typeof import("node:fs")
    if (!statSync(absRoot).isDirectory()) return []
  } catch {
    return []
  }

  const isIncluded = loadIgnoreFilter(absRoot)

  try {
    // Use git ls-files — automatically respects .gitignore
    const { stdout } = await execFileAsync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: absRoot,
      maxBuffer: 50 * 1024 * 1024, // 50MB for large repos
    })

    const files: ScannedFile[] = []
    for (const line of stdout.split("\n")) {
      const relativePath = line.trim()
      if (!relativePath) continue

      // Skip ignored paths (ALWAYS_IGNORE + .gitignore + .unerrignore)
      if (!isIncluded(relativePath)) continue

      files.push({
        relativePath,
        absolutePath: join(absRoot, relativePath),
        extension: extname(relativePath).toLowerCase(),
      })
    }
    return files
  } catch {
    // Fallback: if git ls-files fails, use find (shouldn't happen for cloned repos)
    const { stdout } = await execFileAsync("find", [absRoot, "-type", "f", "-not", "-path", "*/.git/*"], {
      maxBuffer: 50 * 1024 * 1024,
    })

    const files: ScannedFile[] = []
    for (const line of stdout.split("\n")) {
      const absPath = line.trim()
      if (!absPath) continue

      const relativePath = absPath.slice(absRoot.length + 1)
      if (!isIncluded(relativePath)) continue

      files.push({
        relativePath,
        absolutePath: absPath,
        extension: extname(relativePath).toLowerCase(),
      })
    }
    return files
  }
}

/** Detect languages present in a list of scanned files. */
export function detectLanguages(files: ScannedFile[]): LanguageDetection[] {
  const counts = new Map<string, { extensions: Set<string>; count: number }>()

  for (const file of files) {
    const lang = EXTENSION_LANGUAGE[file.extension]
    if (!lang) continue

    const entry = counts.get(lang)
    if (entry) {
      entry.extensions.add(file.extension)
      entry.count++
    } else {
      counts.set(lang, { extensions: new Set([file.extension]), count: 1 })
    }
  }

  return Array.from(counts.entries())
    .map(([language, { extensions, count }]) => ({
      language,
      extensions: Array.from(extensions),
      fileCount: count,
    }))
    .sort((a, b) => b.fileCount - a.fileCount)
}

/** Get the language for a file extension, or undefined for unknown. */
export function getLanguageForExtension(ext: string): string | undefined {
  return EXTENSION_LANGUAGE[ext.toLowerCase()]
}
