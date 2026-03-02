/**
 * Ruby language plugin.
 */
import { runSCIPRuby } from "./scip"
import { parseRubyFile } from "./tree-sitter"
import type { LanguagePlugin, SCIPOptions, TreeSitterOptions } from "../types"

export const rubyPlugin: LanguagePlugin = {
  id: "ruby",
  extensions: [".rb"],

  async runSCIP(opts: SCIPOptions) {
    const allEntities: import("../../types").ParsedEntity[] = []
    const allEdges: import("../../types").ParsedEdge[] = []
    const allCoveredFiles: string[] = []

    for (const root of opts.workspaceRoots) {
      const result = await runSCIPRuby(opts, root)
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)
      allCoveredFiles.push(...result.coveredFiles)
    }

    return { entities: allEntities, edges: allEdges, coveredFiles: allCoveredFiles }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseRubyFile(opts)
  },
}
