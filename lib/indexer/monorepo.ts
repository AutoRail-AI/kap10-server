/**
 * Monorepo / workspace root detection.
 *
 * Detects pnpm, yarn, npm, nx, and lerna workspaces.
 * Returns workspace root paths for SCIP indexers that need per-package runs.
 * A-05: Also detects dominant language per workspace root for polyglot support.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { extname, join, resolve } from "node:path"

import type { WorkspaceInfo } from "./types"

/**
 * Detect workspace roots in a repository.
 * Returns the list of package/module roots and the monorepo tool type.
 */
export function detectWorkspaceRoots(workspacePath: string): WorkspaceInfo {
  const absRoot = resolve(workspacePath)

  // Check pnpm-workspace.yaml
  const pnpmWorkspacePath = join(absRoot, "pnpm-workspace.yaml")
  if (existsSync(pnpmWorkspacePath)) {
    const roots = parsePnpmWorkspace(absRoot, pnpmWorkspacePath)
    if (roots.length > 0) return { roots, type: "pnpm" }
  }

  // Check nx.json
  const nxPath = join(absRoot, "nx.json")
  if (existsSync(nxPath)) {
    const roots = parseNxWorkspace(absRoot)
    if (roots.length > 0) return { roots, type: "nx" }
  }

  // Check lerna.json
  const lernaPath = join(absRoot, "lerna.json")
  if (existsSync(lernaPath)) {
    const roots = parseLernaWorkspace(absRoot, lernaPath)
    if (roots.length > 0) return { roots, type: "lerna" }
  }

  // Check package.json workspaces (yarn/npm)
  const pkgPath = join(absRoot, "package.json")
  if (existsSync(pkgPath)) {
    const roots = parsePackageJsonWorkspaces(absRoot, pkgPath)
    if (roots.length > 0) {
      // Distinguish yarn vs npm
      const yarnLock = join(absRoot, "yarn.lock")
      const type = existsSync(yarnLock) ? "yarn" : "npm"
      return { roots, type }
    }
  }

  // Check Maven multi-module (pom.xml with <modules>)
  const pomPath = join(absRoot, "pom.xml")
  if (existsSync(pomPath)) {
    const roots = parseMavenModules(absRoot, pomPath)
    if (roots.length > 1) return { roots, type: "maven" }
    if (roots.length === 1) return { roots, type: "maven" }
  }

  // Check Gradle multi-project (settings.gradle / settings.gradle.kts)
  const gradleSettingsPath = existsSync(join(absRoot, "settings.gradle.kts"))
    ? join(absRoot, "settings.gradle.kts")
    : existsSync(join(absRoot, "settings.gradle"))
      ? join(absRoot, "settings.gradle")
      : null
  if (gradleSettingsPath) {
    const roots = parseGradleSettings(absRoot, gradleSettingsPath)
    if (roots.length > 1) return { roots, type: "gradle" }
    if (roots.length === 1) return { roots, type: "gradle" }
  }

  // Single-package repo
  return { roots: ["."], type: "single" }
}

/**
 * A-05: Detect the dominant programming language for each workspace root.
 * Scans files in each root directory and returns the language with the most files.
 */
export function detectLanguagePerRoot(
  workspacePath: string,
  roots: string[]
): Record<string, string> {
  const absRoot = resolve(workspacePath)
  const result: Record<string, string> = {}

  for (const root of roots) {
    const rootDir = join(absRoot, root)
    if (!existsSync(rootDir)) continue

    const langCounts = new Map<string, number>()
    countLanguageFiles(rootDir, langCounts, 0, 3)

    // Find dominant language
    let maxCount = 0
    let dominant = "unknown"
    for (const [lang, count] of Array.from(langCounts.entries())) {
      if (count > maxCount) {
        maxCount = count
        dominant = lang
      }
    }
    if (maxCount > 0) result[root] = dominant
  }

  return result
}

/** Extension → language mapping for per-root detection */
const ROOT_EXTENSION_LANGUAGE: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
  ".py": "python", ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java", ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c", ".h": "c",
  ".cpp": "cpp", ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".scala": "scala",
}

/** Recursively count language files up to maxDepth. */
function countLanguageFiles(
  dir: string,
  counts: Map<string, number>,
  depth: number,
  maxDepth: number
): void {
  if (depth > maxDepth) return
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "vendor" || entry.name === "__pycache__") continue
      if (entry.isDirectory()) {
        countLanguageFiles(join(dir, entry.name), counts, depth + 1, maxDepth)
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        const lang = ROOT_EXTENSION_LANGUAGE[ext]
        if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1)
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}

/** Parse pnpm-workspace.yaml to extract workspace glob patterns, then resolve to actual dirs. */
function parsePnpmWorkspace(absRoot: string, yamlPath: string): string[] {
  try {
    const content = readFileSync(yamlPath, "utf-8")
    // Simple YAML parsing for the packages field — avoids importing js-yaml at top level
    const packagesMatch = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)*)/)
    if (!packagesMatch) return []

    const patterns = packagesMatch[1]!
      .split("\n")
      .map((line) => line.replace(/^\s*-\s*['"]?/, "").replace(/['"]?\s*$/, ""))
      .filter(Boolean)

    return resolveGlobPatterns(absRoot, patterns)
  } catch {
    return []
  }
}

/** Parse package.json "workspaces" field. */
function parsePackageJsonWorkspaces(absRoot: string, pkgPath: string): string[] {
  try {
    const content = readFileSync(pkgPath, "utf-8")
    const pkg = JSON.parse(content) as { workspaces?: string[] | { packages?: string[] } }
    const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages
    if (!workspaces || workspaces.length === 0) return []
    return resolveGlobPatterns(absRoot, workspaces)
  } catch {
    return []
  }
}

/** Parse nx.json projects. */
function parseNxWorkspace(absRoot: string): string[] {
  // Nx typically uses packages/* or apps/* + libs/*
  // Check for common patterns
  const candidates = ["packages", "apps", "libs"]
  const roots: string[] = []
  for (const dir of candidates) {
    const fullPath = join(absRoot, dir)
    if (existsSync(fullPath)) {
      roots.push(...resolveGlobPatterns(absRoot, [`${dir}/*`]))
    }
  }
  return roots.length > 0 ? roots : ["."]
}

/** Parse lerna.json packages field. */
function parseLernaWorkspace(absRoot: string, lernaPath: string): string[] {
  try {
    const content = readFileSync(lernaPath, "utf-8")
    const lerna = JSON.parse(content) as { packages?: string[] }
    if (!lerna.packages || lerna.packages.length === 0) return []
    return resolveGlobPatterns(absRoot, lerna.packages)
  } catch {
    return []
  }
}

/**
 * Resolve simple glob patterns (e.g., "packages/*") to actual directories.
 * Only supports single-level wildcards — sufficient for workspace detection.
 */
function resolveGlobPatterns(absRoot: string, patterns: string[]): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs")
  const roots: string[] = []

  for (const pattern of patterns) {
    // Remove negation patterns
    if (pattern.startsWith("!")) continue

    const cleaned = pattern.replace(/\/\*$/, "").replace(/\/\*\*$/, "")
    if (cleaned.includes("*")) {
      // Pattern like "packages/*/sub" — skip complex patterns
      continue
    }

    const dirPath = join(absRoot, cleaned)
    if (!existsSync(dirPath)) continue

    // If the original pattern ended with /*, list subdirectories
    if (pattern.endsWith("/*") || pattern.endsWith("/**")) {
      try {
        const entries = readdirSync(dirPath)
        for (const entry of entries) {
          const entryPath = join(dirPath, entry)
          try {
            if (statSync(entryPath).isDirectory()) {
              roots.push(join(cleaned, entry))
            }
          } catch {
            // skip inaccessible entries
          }
        }
      } catch {
        // skip inaccessible directories
      }
    } else {
      roots.push(cleaned)
    }
  }

  return roots
}

/** Parse Maven pom.xml to extract <modules> entries. */
function parseMavenModules(absRoot: string, pomPath: string): string[] {
  try {
    const content = readFileSync(pomPath, "utf-8")
    // Simple XML parsing for <modules><module>name</module></modules>
    const modulesMatch = content.match(/<modules>([\s\S]*?)<\/modules>/)
    if (!modulesMatch) return ["."]

    const moduleNames: string[] = []
    const moduleRegex = /<module>\s*([^<]+)\s*<\/module>/g
    let match: RegExpExecArray | null
    while ((match = moduleRegex.exec(modulesMatch[1]!)) !== null) {
      const moduleName = match[1]!.trim()
      if (moduleName && existsSync(join(absRoot, moduleName))) {
        moduleNames.push(moduleName)
      }
    }

    return moduleNames.length > 0 ? moduleNames : ["."]
  } catch {
    return ["."]
  }
}

/** Parse Gradle settings.gradle(.kts) to extract include() entries. */
function parseGradleSettings(absRoot: string, settingsPath: string): string[] {
  try {
    const content = readFileSync(settingsPath, "utf-8")
    const modules: string[] = []

    // Match include("module") or include(":module") or include ':module'
    const includeRegex = /include\s*\(?['"][:.]?([^'"]+)['"]/g
    let match: RegExpExecArray | null
    while ((match = includeRegex.exec(content)) !== null) {
      // Gradle uses ":" as path separator, convert to filesystem path
      const modulePath = match[1]!.replace(/:/g, "/").trim()
      if (modulePath && existsSync(join(absRoot, modulePath))) {
        modules.push(modulePath)
      }
    }

    return modules.length > 0 ? modules : ["."]
  } catch {
    return ["."]
  }
}
