/**
 * Python language plugin.
 */
import { runSCIPPython } from "./scip"
import { parsePythonFile } from "./tree-sitter"
import type { LanguagePlugin, SCIPOptions, TreeSitterOptions } from "../types"

export const pythonPlugin: LanguagePlugin = {
  id: "python",
  extensions: [".py", ".pyi"],

  async runSCIP(opts: SCIPOptions) {
    const allEntities: import("../../types").ParsedEntity[] = []
    const allEdges: import("../../types").ParsedEdge[] = []
    const allCoveredFiles: string[] = []

    for (const root of opts.workspaceRoots) {
      const result = await runSCIPPython(opts, root)
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)
      allCoveredFiles.push(...result.coveredFiles)
    }

    return { entities: allEntities, edges: allEdges, coveredFiles: allCoveredFiles }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parsePythonFile(opts)
  },
}
