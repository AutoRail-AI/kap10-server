/**
 * PHP language plugin.
 */
import { parsePhpFile } from "./tree-sitter"
import type { LanguagePlugin, TreeSitterOptions } from "../types"

export const phpPlugin: LanguagePlugin = {
  id: "php",
  extensions: [".php"],

  async runSCIP() {
    return { entities: [], edges: [], coveredFiles: [] }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parsePhpFile(opts)
  },
}
