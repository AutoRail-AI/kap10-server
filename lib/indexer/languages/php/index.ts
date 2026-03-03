/**
 * PHP language plugin.
 */
import { runSCIPPhp } from "./scip"
import { parsePhpFile } from "./tree-sitter"
import type { LanguagePlugin, SCIPOptions, TreeSitterOptions } from "../types"

export const phpPlugin: LanguagePlugin = {
  id: "php",
  extensions: [".php"],

  async runSCIP(opts: SCIPOptions) {
    const allEntities: import("../../types").ParsedEntity[] = []
    const allEdges: import("../../types").ParsedEdge[] = []
    const allCoveredFiles: string[] = []

    for (const root of opts.packageRoots) {
      const result = await runSCIPPhp(opts, root)
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)
      allCoveredFiles.push(...result.coveredFiles)
    }

    return { entities: allEntities, edges: allEdges, coveredFiles: allCoveredFiles }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parsePhpFile(opts)
  },
}
