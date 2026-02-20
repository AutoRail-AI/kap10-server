/**
 * Language plugin interface.
 *
 * Each language (TypeScript, Python, Go, etc.) implements this interface
 * to provide SCIP-based indexing and tree-sitter fallback parsing.
 * New languages are added by creating a new folder under languages/
 * and registering the plugin in the registry.
 */
import type { ParsedEdge, ParsedEntity } from "../types"

export interface SCIPOptions {
  workspacePath: string
  workspaceRoots: string[]
  orgId: string
  repoId: string
}

export interface TreeSitterOptions {
  filePath: string
  content: string
  orgId: string
  repoId: string
}

export interface LanguagePlugin {
  /** Unique identifier (e.g., "typescript", "python", "go") */
  id: string

  /** File extensions handled by this plugin (e.g., [".ts", ".tsx", ".js", ".jsx"]) */
  extensions: string[]

  /**
   * Primary: SCIP-based indexing (precise, cross-file references).
   * Returns entities, edges, and the list of files successfully covered.
   */
  runSCIP(opts: SCIPOptions): Promise<{
    entities: ParsedEntity[]
    edges: ParsedEdge[]
    coveredFiles: string[]
  }>

  /**
   * Fallback: tree-sitter parsing for files SCIP missed.
   * Extracts structural entities (functions, classes, etc.) from a single file.
   */
  parseWithTreeSitter(opts: TreeSitterOptions): Promise<{
    entities: ParsedEntity[]
    edges: ParsedEdge[]
  }>
}
