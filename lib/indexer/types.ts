/**
 * Shared types for the indexing pipeline.
 * Used by language plugins, scanner, entity hashing, and activities.
 */

/** Entity extracted from source code (function, class, interface, file, etc.) */
export interface ParsedEntity {
  /** Deterministic hash set by entity-hash.ts — used as ArangoDB _key */
  id: string
  kind: EntityKind
  name: string
  file_path: string
  /** 1-based start line */
  start_line?: number
  /** 1-based end line */
  end_line?: number
  /** Function/method signature (for hashing stability) */
  signature?: string
  /** Language identifier */
  language?: string
  /** Export visibility */
  exported?: boolean
  /** Documentation string */
  doc?: string
  /** Parent entity name (e.g., class name for a method) */
  parent?: string
  /** Source code body (truncated to MAX_BODY_LINES lines at extraction time) */
  body?: string
  /** Whether the function/method is async */
  is_async?: boolean
  /** Number of parameters (excludes self/cls in Python) */
  parameter_count?: number
  /** Return type annotation (if available) */
  return_type?: string
  /** Cyclomatic complexity estimate (baseline = 1) */
  complexity?: number
}

/** Maximum number of source lines to store per entity body */
export const MAX_BODY_LINES = 3000

export type EntityKind =
  | "file"
  | "directory"
  | "function"
  | "class"
  | "interface"
  | "method"
  | "variable"
  | "type"
  | "enum"
  | "module"
  | "namespace"
  | "decorator"
  | "struct"

/** Edge (relationship) between two entities */
export interface ParsedEdge {
  from_id: string
  to_id: string
  kind: EdgeKind
  /** Extra metadata (e.g., imported_symbols for import edges) */
  [key: string]: unknown
}

export type EdgeKind =
  | "contains"
  | "calls"
  | "imports"
  | "implements"
  | "extends"
  | "references"
  | "overrides"
  | "returns"
  | "parameter_of"
  | "member_of"

/** Result from a language plugin's SCIP indexing */
export interface SCIPResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

/** Result from a language plugin's tree-sitter parsing */
export interface TreeSitterResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

/** File discovered by the scanner */
export interface ScannedFile {
  /** Relative path from workspace root */
  relativePath: string
  /** Absolute path on disk */
  absolutePath: string
  /** File extension (e.g., ".ts") */
  extension: string
}

/** Detected language in a workspace */
export interface LanguageDetection {
  language: string
  extensions: string[]
  fileCount: number
}

/** Workspace info returned by monorepo detection */
export interface WorkspaceInfo {
  /** Root paths for monorepo packages (or ["."] for single-package repos) */
  roots: string[]
  /** Type of monorepo tooling detected */
  type: "pnpm" | "yarn" | "npm" | "nx" | "lerna" | "single"
}
