/**
 * C++ language plugin.
 */
import { parseCppFile } from "./tree-sitter"
import type { LanguagePlugin, TreeSitterOptions } from "../types"

export const cppPlugin: LanguagePlugin = {
  id: "cpp",
  extensions: [".cpp", ".hpp", ".cc", ".cxx", ".hxx"],

  async runSCIP() {
    return { entities: [], edges: [], coveredFiles: [] }
  },

  async parseWithTreeSitter(opts: TreeSitterOptions) {
    return parseCppFile(opts)
  },
}
