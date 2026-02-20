/**
 * TypeScript/JavaScript language plugin.
 *
 * Provides SCIP-based precise indexing with tree-sitter regex fallback
 * for files that SCIP doesn't cover.
 */
import type { LanguagePlugin, SCIPOptions, TreeSitterOptions } from "../types"
import { runSCIPTypeScript } from "./scip"
import { parseTypeScriptFile } from "./tree-sitter"

export const typescriptPlugin: LanguagePlugin = {
  id: "typescript",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],

  async runSCIP(opts: SCIPOptions) {
    const allEntities: import("../../types").ParsedEntity[] = []
    const allEdges: import("../../types").ParsedEdge[] = []
    const allCoveredFiles: string[] = []

    // Run SCIP for each workspace root (monorepo support)
    for (const root of opts.workspaceRoots) {
      const result = await runSCIPTypeScript(opts, root)
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)
      allCoveredFiles.push(...result.coveredFiles)
    }

    return {
      entities: allEntities,
      edges: allEdges,
      coveredFiles: allCoveredFiles,
    }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseTypeScriptFile(opts)
  },
}
