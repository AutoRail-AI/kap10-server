/**
 * Unified file ignore utility for the indexing pipeline.
 *
 * Loads .gitignore + .unerrignore patterns from a repo root and returns
 * a predicate function. Cached per indexDir within the same process.
 */
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * Directories always excluded from indexing, regardless of ignore files.
 *
 * Organized by ecosystem. Every supported language's standard build/cache/
 * dependency directories must be listed here so that SCIP, tree-sitter,
 * Semgrep, and the CLI all agree on what to skip.
 *
 * These are exact directory names matched via Set.has() for fast O(1) lookup
 * in directory walkers. Do NOT add glob patterns here — use ALWAYS_IGNORE_GLOBS
 * for patterns that require the `ignore` package's glob matching.
 *
 * IMPORTANT: When adding entries here, also add them to the CLI's
 * ALWAYS_IGNORE list in packages/cli/src/ignore.ts.
 */
export const ALWAYS_IGNORE = new Set([
  // ── Version control ───────────────────────────────────────────────
  ".git",
  ".svn",
  ".hg",

  // ── JavaScript / TypeScript (Node, pnpm, Yarn, Bun) ───────────────
  "node_modules",
  ".next",
  ".turbo",
  ".yarn",
  ".pnp",           // Yarn PnP

  // ── Python ────────────────────────────────────────────────────────
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  ".eggs",

  // ── Go ────────────────────────────────────────────────────────────
  // Go modules cache is in GOPATH, but vendor/ is repo-local

  // ── Rust ──────────────────────────────────────────────────────────
  "target",         // cargo build output

  // ── Java / Kotlin / Scala (Maven, Gradle) ─────────────────────────
  ".gradle",
  ".mvn",

  // ── C# / .NET ─────────────────────────────────────────────────────
  "bin",
  "obj",
  ".nuget",

  // ── Ruby ──────────────────────────────────────────────────────────
  ".bundle",

  // ── PHP ───────────────────────────────────────────────────────────
  // vendor/ is already listed below

  // ── Generic build / tooling ───────────────────────────────────────
  "dist",
  "build",
  "out",
  "vendor",
  ".cache",
  "coverage",
  ".idea",
  ".vscode",
])

/**
 * Glob patterns that require the `ignore` package for matching.
 * These are added to the ignore instance alongside ALWAYS_IGNORE entries
 * but cannot be used with Set.has() for segment matching.
 */
export const ALWAYS_IGNORE_GLOBS = [
  "*.egg-info/",    // Python egg metadata directories
]

const cache = new Map<string, (relativePath: string) => boolean>()

/**
 * Build an ignore filter from .gitignore + .unerrignore at the given root.
 * @returns A function that returns `true` if the path should be INCLUDED.
 */
export function loadIgnoreFilter(indexDir: string): (relativePath: string) => boolean {
  const root = resolve(indexDir)
  const hit = cache.get(root)
  if (hit) return hit

  const { default: ignore } = require("ignore") as typeof import("ignore")
  const ig = ignore()

  // Always-ignored directories as glob patterns
  for (const dir of ALWAYS_IGNORE) ig.add(`${dir}/`)
  for (const glob of ALWAYS_IGNORE_GLOBS) ig.add(glob)

  // .gitignore
  readIgnoreFile(ig, join(root, ".gitignore"))

  // .unerrignore
  readIgnoreFile(ig, join(root, ".unerrignore"))

  const filter = (rel: string): boolean => !ig.ignores(rel)
  cache.set(root, filter)
  return filter
}

/** Clear the ignore filter cache. Used for test isolation. */
export function clearIgnoreCache(): void {
  cache.clear()
}

/** Safely read an ignore file and add its patterns. */
function readIgnoreFile(ig: ReturnType<typeof import("ignore")["default"]>, path: string): void {
  if (!existsSync(path)) return
  try {
    ig.add(readFileSync(path, "utf-8"))
  } catch {
    // Skip unreadable files
  }
}
