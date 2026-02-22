/**
 * Dependency check — detects new imports not previously seen in the repo's graph.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"
import type { DependencyFinding, ReviewConfig } from "@/lib/ports/types"
import type { DiffFile } from "../diff-analyzer"

export async function runDependencyCheck(
  orgId: string,
  repoId: string,
  diffFiles: DiffFile[],
  workspacePath: string,
  graphStore: IGraphStore,
  config: ReviewConfig
): Promise<DependencyFinding[]> {
  if (!config.checksEnabled.dependency) return []

  const findings: DependencyFinding[] = []
  const fs = await import("node:fs")
  const path = await import("node:path")

  // Get existing import edges from graph
  const existingEdges = await graphStore.getAllEdges(orgId, repoId)
  const existingImports = new Set(
    existingEdges
      .filter((e) => e.kind === "imports")
      .map((e) => {
        const toKey = e._to.split("/").pop() ?? ""
        return toKey
      })
  )

  for (const file of diffFiles) {
    // Only check TS/JS files
    if (!/\.(ts|tsx|js|jsx)$/.test(file.filePath)) continue

    // Skip ignored paths
    if (config.ignorePaths.some((p) => file.filePath.startsWith(p))) continue

    try {
      const fullPath = path.join(workspacePath, file.filePath)
      const content = fs.readFileSync(fullPath, "utf-8")
      const lines = content.split("\n")

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        // Match import statements
        const importMatch = line.match(/(?:import|require)\s*\(?["']([^"']+)["']\)?/)
        if (!importMatch) continue

        const importPath = importMatch[1]!
        // Skip relative imports and node builtins
        if (importPath.startsWith(".") || importPath.startsWith("node:")) continue

        // Check if this import path is new (not in existing graph)
        const packageName = importPath.startsWith("@")
          ? importPath.split("/").slice(0, 2).join("/")
          : importPath.split("/")[0]!

        if (!existingImports.has(packageName) && !existingImports.has(importPath)) {
          findings.push({
            filePath: file.filePath,
            importPath: importPath,
            line: i + 1,
            message: `New dependency detected: \`${packageName}\`. This package was not previously imported in the codebase.`,
          })
          // Add to set to avoid duplicate findings for same package
          existingImports.add(packageName)
        }
      }
    } catch {
      // File might not exist in workspace — skip
    }
  }

  return findings
}
