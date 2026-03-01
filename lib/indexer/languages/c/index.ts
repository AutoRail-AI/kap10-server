/**
 * C language plugin.
 */
import { parseCFile } from "./tree-sitter"
import type { LanguagePlugin, TreeSitterOptions } from "../types"

export const cPlugin: LanguagePlugin = {
  id: "c",
  extensions: [".c", ".h"],

  async runSCIP() {
    // No SCIP support for C — return empty
    return { entities: [], edges: [], coveredFiles: [] }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseCFile(opts)
  },
}
