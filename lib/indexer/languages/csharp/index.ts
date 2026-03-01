/**
 * C# language plugin.
 */
import { parseCSharpFile } from "./tree-sitter"
import type { LanguagePlugin, TreeSitterOptions } from "../types"

export const csharpPlugin: LanguagePlugin = {
  id: "csharp",
  extensions: [".cs"],

  async runSCIP() {
    return { entities: [], edges: [], coveredFiles: [] }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseCSharpFile(opts)
  },
}
