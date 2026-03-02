/**
 * C# language plugin.
 */
import { runSCIPDotnet } from "./scip"
import { parseCSharpFile } from "./tree-sitter"
import type { LanguagePlugin, SCIPOptions, TreeSitterOptions } from "../types"

export const csharpPlugin: LanguagePlugin = {
  id: "csharp",
  extensions: [".cs"],

  async runSCIP(opts: SCIPOptions) {
    const allEntities: import("../../types").ParsedEntity[] = []
    const allEdges: import("../../types").ParsedEdge[] = []
    const allCoveredFiles: string[] = []

    for (const root of opts.workspaceRoots) {
      const result = await runSCIPDotnet(opts, root)
      allEntities.push(...result.entities)
      allEdges.push(...result.edges)
      allCoveredFiles.push(...result.coveredFiles)
    }

    return { entities: allEntities, edges: allEdges, coveredFiles: allCoveredFiles }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseCSharpFile(opts)
  },
}
