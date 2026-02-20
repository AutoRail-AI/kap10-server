/**
 * Go language plugin.
 */
import type { LanguagePlugin, SCIPOptions, TreeSitterOptions } from "../types"
import { runSCIPGo } from "./scip"
import { parseGoFile } from "./tree-sitter"

export const goPlugin: LanguagePlugin = {
  id: "go",
  extensions: [".go"],

  async runSCIP(opts: SCIPOptions) {
    const allEntities: import("../../types").ParsedEntity[] = []
    const allEdges: import("../../types").ParsedEdge[] = []
    const allCoveredFiles: string[] = []

    for (const root of opts.workspaceRoots) {
      const result = await runSCIPGo(opts, root)
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)
      allCoveredFiles.push(...result.coveredFiles)
    }

    return { entities: allEntities, edges: allEdges, coveredFiles: allCoveredFiles }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseGoFile(opts)
  },
}
