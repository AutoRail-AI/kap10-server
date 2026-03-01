/**
 * Ruby language plugin.
 */
import { parseRubyFile } from "./tree-sitter"
import type { LanguagePlugin, TreeSitterOptions } from "../types"

export const rubyPlugin: LanguagePlugin = {
  id: "ruby",
  extensions: [".rb"],

  async runSCIP() {
    return { entities: [], edges: [], coveredFiles: [] }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseRubyFile(opts)
  },
}
