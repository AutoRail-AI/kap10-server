/**
 * C language plugin.
 */
import { runSCIPClang } from "./scip"
import { parseCFile } from "./tree-sitter"
import type { LanguagePlugin, SCIPOptions, TreeSitterOptions } from "../types"

export const cPlugin: LanguagePlugin = {
  id: "c",
  extensions: [".c", ".h"],

  async runSCIP(opts: SCIPOptions) {
    const allEntities: import("../../types").ParsedEntity[] = []
    const allEdges: import("../../types").ParsedEdge[] = []
    const allCoveredFiles: string[] = []

    for (const root of opts.workspaceRoots) {
      const result = await runSCIPClang(opts, root, "c")
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)
      allCoveredFiles.push(...result.coveredFiles)
    }

    return { entities: allEntities, edges: allEdges, coveredFiles: allCoveredFiles }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseCFile(opts)
  },
}
