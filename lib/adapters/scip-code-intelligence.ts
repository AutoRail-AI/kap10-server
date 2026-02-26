/**
 * SCIPCodeIntelligence — ICodeIntelligence implementation using SCIP.
 *
 * Uses the modular language plugin system in `lib/indexer/` to run SCIP indexers
 * per language, parse the SCIP protobuf output, and extract entities + edges.
 *
 * The `indexWorkspace()` method is the primary entry point used by Temporal
 * activities. IDE-style methods (getDefinitions, getReferences) are planned
 * for Phase 2 (Shadow Workspace overlay).
 */

import { getPluginsForExtensions, initializeRegistry } from "@/lib/indexer/languages/registry"
import { detectWorkspaceRoots } from "@/lib/indexer/monorepo"
import { detectLanguages, scanWorkspace } from "@/lib/indexer/scanner"
import type { ParsedEdge, ParsedEntity } from "@/lib/indexer/types"
import type { Definition, ICodeIntelligence, Reference } from "@/lib/ports/code-intelligence"

export interface IndexWorkspaceResult {
  filesProcessed: number
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
  languages: string[]
}

export class SCIPCodeIntelligence implements ICodeIntelligence {
  /**
   * Index a workspace by running SCIP indexers for each detected language.
   *
   * Returns the number of files processed. The full entity/edge data is
   * available via `indexWorkspaceFull()` for callers that need it.
   */
  async indexWorkspace(workspacePath: string): Promise<{ filesProcessed: number }> {
    const result = await this.indexWorkspaceFull(workspacePath, "unknown-org", "unknown-repo")
    return { filesProcessed: result.filesProcessed }
  }

  /**
   * Full workspace indexing with entity/edge extraction.
   * Used by Temporal activities that need the complete parsed output.
   */
  async indexWorkspaceFull(
    workspacePath: string,
    orgId: string,
    repoId: string,
  ): Promise<IndexWorkspaceResult> {
    await initializeRegistry()

    // Scan files and detect languages
    const files = await scanWorkspace(workspacePath)
    const languages = detectLanguages(files).map((l) => l.language)

    // Detect monorepo workspace roots
    const workspaceInfo = detectWorkspaceRoots(workspacePath)
    const workspaceRoots = workspaceInfo.roots

    // Get plugins for detected extensions
    const extensions = Array.from(new Set(files.map((f) => f.extension)))
    const plugins = getPluginsForExtensions(extensions)

    const allEntities: ParsedEntity[] = []
    const allEdges: ParsedEdge[] = []
    const allCoveredFiles: string[] = []

    // Run SCIP for each language plugin
    for (const plugin of plugins) {
      try {
        const result = await plugin.runSCIP({
          workspacePath,
          workspaceRoots,
          orgId,
          repoId,
        })
        allEntities.push(...result.entities)
        allEdges.push(...result.edges)
        allCoveredFiles.push(...result.coveredFiles)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[SCIPCodeIntelligence] Plugin ${plugin.id} SCIP failed: ${message}`)
      }
    }

    // Parse uncovered files with regex fallback
    const coveredSet = new Set(allCoveredFiles)
    const uncoveredFiles = files.filter((f) => !coveredSet.has(f.relativePath))

    for (const file of uncoveredFiles) {
      const plugin = plugins.find((p) =>
        p.extensions.includes(file.extension.toLowerCase()),
      )
      if (!plugin) continue

      try {
        const { readFileSync } = require("node:fs") as typeof import("node:fs")
        const content = readFileSync(file.absolutePath, "utf-8")
        const result = await plugin.parseWithTreeSitter({
          filePath: file.relativePath,
          content,
          orgId,
          repoId,
        })
        allEntities.push(...result.entities)
        allEdges.push(...result.edges)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[SCIPCodeIntelligence] Parse fallback failed for ${file.relativePath}: ${message}`)
      }
    }

    return {
      filesProcessed: files.length,
      entities: allEntities,
      edges: allEdges,
      coveredFiles: allCoveredFiles,
      languages,
    }
  }

  /**
   * Get definitions at a position (Phase 2 — Shadow Workspace).
   * Requires SCIP index to be loaded and queried in-memory.
   */
  async getDefinitions(_filePath: string, _line: number, _column: number): Promise<Definition[]> {
    // Phase 2: Will query cached SCIP index for definitions
    return []
  }

  /**
   * Get references at a position (Phase 2 — Shadow Workspace).
   * Requires SCIP index to be loaded and queried in-memory.
   */
  async getReferences(_filePath: string, _line: number, _column: number): Promise<Reference[]> {
    // Phase 2: Will query cached SCIP index for references
    return []
  }
}
