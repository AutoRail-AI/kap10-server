/**
 * Shared ignore-file loader for CLI commands.
 * Supports .gitignore + .unerrignore with gitignore syntax.
 *
 * The ALWAYS_IGNORE list must stay in sync with the server-side set
 * in lib/indexer/ignore.ts. The CLI adds `.unerr` (local config dir)
 * which is CLI-specific and not needed server-side.
 */
import fs from "node:fs"
import path from "node:path"

/**
 * Directories always excluded, matching the server-side ALWAYS_IGNORE set
 * in lib/indexer/ignore.ts plus `.unerr` (CLI local config directory).
 *
 * IMPORTANT: Keep in sync with the server-side ALWAYS_IGNORE set.
 */
const ALWAYS_IGNORE = [
  // Version control
  ".git", ".svn", ".hg",
  // JavaScript / TypeScript
  "node_modules", ".next", ".turbo", ".yarn", ".pnp",
  // Python
  "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", ".venv", "venv", ".eggs",
  // Rust
  "target",
  // Java / Kotlin / Scala
  ".gradle", ".mvn",
  // C# / .NET
  "bin", "obj", ".nuget",
  // Ruby
  ".bundle",
  // Generic build / tooling
  "dist", "build", "out", "vendor", ".cache", "coverage", ".idea", ".vscode",
  // CLI-specific
  ".unerr",
]

/**
 * Create an ignore filter for a project root.
 * @returns An ignore instance with .ignores(relativePath) method.
 */
export async function createIgnoreFilter(cwd: string) {
  const { default: ignore } = await import("ignore")
  const ig = ignore()

  ig.add(ALWAYS_IGNORE.map((d) => `${d}/`))

  // .gitignore
  const gitignorePath = path.join(cwd, ".gitignore")
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, "utf-8"))
  }

  // .unerrignore
  const unerrignorePath = path.join(cwd, ".unerrignore")
  if (fs.existsSync(unerrignorePath)) {
    ig.add(fs.readFileSync(unerrignorePath, "utf-8"))
  }

  return ig
}
