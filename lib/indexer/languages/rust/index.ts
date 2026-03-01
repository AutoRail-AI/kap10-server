/**
 * Rust language plugin.
 */
import { parseRustFile } from "./tree-sitter"
import type { LanguagePlugin, TreeSitterOptions } from "../types"

export const rustPlugin: LanguagePlugin = {
  id: "rust",
  extensions: [".rs"],

  async runSCIP() {
    return { entities: [], edges: [], coveredFiles: [] }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseRustFile(opts)
  },
}
