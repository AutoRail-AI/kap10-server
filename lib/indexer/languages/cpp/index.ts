/**
 * C++ language plugin.
 * Shares the scip-clang indexer with the C plugin.
 */
import { parseCppFile } from "./tree-sitter"
import { runSCIPClang } from "../c/scip"
import type { LanguagePlugin, SCIPOptions, TreeSitterOptions } from "../types"

export const cppPlugin: LanguagePlugin = {
  id: "cpp",
  extensions: [".cpp", ".hpp", ".cc", ".cxx", ".hxx"],

  async runSCIP(opts: SCIPOptions) {
    const allEntities: import("../../types").ParsedEntity[] = []
    const allEdges: import("../../types").ParsedEdge[] = []
    const allCoveredFiles: string[] = []

    for (const root of opts.packageRoots) {
      const result = await runSCIPClang(opts, root, "cpp")
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)
      allCoveredFiles.push(...result.coveredFiles)
    }

    return { entities: allEntities, edges: allEdges, coveredFiles: allCoveredFiles }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseCppFile(opts)
  },
}
