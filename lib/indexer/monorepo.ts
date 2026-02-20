/**
 * Monorepo / workspace root detection.
 *
 * Detects pnpm, yarn, npm, nx, and lerna workspaces.
 * Returns workspace root paths for SCIP indexers that need per-package runs.
 */
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

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

  // Single-package repo
  return { roots: ["."], type: "single" }
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
