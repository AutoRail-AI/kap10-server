/**
 * Tree-sitter fallback parser for TypeScript/JavaScript.
 *
 * Extracts functions, classes, interfaces, methods, exports, and type aliases
 * from source files when SCIP indexing is unavailable or misses files.
 */
import { extractJSDocComment } from "../../doc-extractor"
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import { MAX_BODY_LINES } from "../../types"
import type { TreeSitterOptions } from "../types"

export interface TreeSitterParseResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

/**
 * Parse a TypeScript/JavaScript file using regex-based extraction.
 *
 * Uses robust regex patterns instead of tree-sitter WASM to avoid
 * native dependency issues. Extracts the same entity types that
 * tree-sitter would find: functions, classes, interfaces, methods,
 * type aliases, and enums.
 */
export function parseTypeScriptFile(opts: TreeSitterOptions): TreeSitterParseResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const lines = opts.content.split("\n")

  // First pass: extract import edges with metadata
  const fileId = entityHash(opts.repoId, opts.filePath, "file", opts.filePath)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()

    // import { Foo, Bar } from "./module"
    // import type { Baz } from "@/lib/types"
    // import DefaultExport from "./module"
    const importMatch = line.match(
      /^import\s+(type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+["']([^"']+)["']/
    )
    if (importMatch) {
      const isTypeOnly = !!importMatch[1]
      const namedImports = importMatch[2]
      const defaultImport = importMatch[3]
      const source = importMatch[4]!

      // Only create edges for internal imports (relative or alias)
      if (source.startsWith(".") || source.startsWith("@/") || source.startsWith("~/")) {
        const symbols: string[] = []
        if (namedImports) {
          for (const sym of namedImports.split(",")) {
            const trimmed = sym.trim().split(/\s+as\s+/)[0]!.trim()
            if (trimmed) symbols.push(trimmed)
          }
        }
        if (defaultImport) symbols.push(defaultImport)

        const targetFileId = entityHash(opts.repoId, resolveImportPath(opts.filePath, source), "file", resolveImportPath(opts.filePath, source))
        edges.push({
          from_id: fileId,
          to_id: targetFileId,
          kind: "imports",
          imported_symbols: symbols,
          import_type: isTypeOnly ? "type" : "value",
          is_type_only: isTypeOnly,
        })
      }
    }
  }

  // Track current class/interface scope for method extraction
  let currentClass: ParsedEntity | null = null
  let braceDepth = 0
  let classStartDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1

    // Track brace depth for class scope
    for (const ch of line) {
      if (ch === "{") braceDepth++
      if (ch === "}") {
        braceDepth--
        if (currentClass && braceDepth < classStartDepth) {
          currentClass = null
        }
      }
    }

    // Skip comments and empty lines
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue
    }

    // Exported function declarations
    const funcMatch = trimmed.match(
      /^(export\s+)?(export\s+default\s+)?(async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)/,
    )
    if (funcMatch) {
      const name = funcMatch[4]!
      const exported = !!(funcMatch[1] || funcMatch[2])
      const params = funcMatch[6] ?? ""
      const sig = `function ${name}(${params})`
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
        kind: "function",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: detectLanguageFromPath(opts.filePath),
        exported,
        signature: sig,
        doc: extractJSDocComment(lines, i),
        is_async: !!funcMatch[3],
        parameter_count: countParams(params),
        return_type: extractReturnType(trimmed),
      }
      entities.push(entity)
      continue
    }

    // Arrow function / const declarations
    const arrowMatch = trimmed.match(
      /^(export\s+)?(const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\(?/,
    )
    if (arrowMatch && (trimmed.includes("=>") || trimmed.includes("function"))) {
      const name = arrowMatch[3]!
      const exported = !!arrowMatch[1]
      const sig = `const ${name}`
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
        kind: "function",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: detectLanguageFromPath(opts.filePath),
        exported,
        signature: sig,
        doc: extractJSDocComment(lines, i),
        is_async: !!arrowMatch[4],
      }
      entities.push(entity)
      continue
    }

    // Class declarations
    const classMatch = trimmed.match(
      /^(export\s+)?(export\s+default\s+)?(abstract\s+)?class\s+(\w+)(\s+extends\s+(\w+))?(\s+implements\s+(.+?))?(\s*\{)?$/,
    )
    if (classMatch) {
      const name = classMatch[4]!
      const exported = !!(classMatch[1] || classMatch[2])
      const extendsClass = classMatch[6]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "class", name),
        kind: "class",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: detectLanguageFromPath(opts.filePath),
        exported,
        doc: extractJSDocComment(lines, i),
      }
      entities.push(entity)
      currentClass = entity
      classStartDepth = braceDepth

      // Create extends edge
      if (extendsClass) {
        const parentId = entityHash(opts.repoId, opts.filePath, "class", extendsClass)
        edges.push({ from_id: entity.id, to_id: parentId, kind: "extends" })
      }

      continue
    }

    // Interface declarations
    const ifaceMatch = trimmed.match(
      /^(export\s+)?interface\s+(\w+)(\s+extends\s+(.+?))?(\s*\{)?$/,
    )
    if (ifaceMatch) {
      const name = ifaceMatch[2]!
      const exported = !!ifaceMatch[1]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "interface", name),
        kind: "interface",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: detectLanguageFromPath(opts.filePath),
        exported,
        doc: extractJSDocComment(lines, i),
      }
      entities.push(entity)
      currentClass = entity
      classStartDepth = braceDepth
      continue
    }

    // Type alias
    const typeMatch = trimmed.match(/^(export\s+)?type\s+(\w+)/)
    if (typeMatch) {
      const name = typeMatch[2]!
      const exported = !!typeMatch[1]
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "type", name),
        kind: "type",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: detectLanguageFromPath(opts.filePath),
        exported,
        doc: extractJSDocComment(lines, i),
      })
      continue
    }

    // Enum declarations
    const enumMatch = trimmed.match(/^(export\s+)?(const\s+)?enum\s+(\w+)/)
    if (enumMatch) {
      const name = enumMatch[3]!
      const exported = !!enumMatch[1]
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "enum", name),
        kind: "enum",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: detectLanguageFromPath(opts.filePath),
        exported,
        doc: extractJSDocComment(lines, i),
      })
      continue
    }

    // Methods inside classes/interfaces
    if (currentClass) {
      const methodMatch = trimmed.match(
        /^(public\s+|private\s+|protected\s+)?(static\s+)?(async\s+)?(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)/,
      )
      if (methodMatch && !trimmed.startsWith("if") && !trimmed.startsWith("for") && !trimmed.startsWith("while")) {
        const name = methodMatch[4]!
        if (name !== "constructor" || true) {
          const params = methodMatch[6] ?? ""
          const sig = `${currentClass.name}.${name}(${params})`
          const entity: ParsedEntity = {
            id: entityHash(opts.repoId, opts.filePath, "method", name, sig),
            kind: "method",
            name,
            file_path: opts.filePath,
            start_line: lineNum,
            language: detectLanguageFromPath(opts.filePath),
            signature: sig,
            parent: currentClass.name,
            doc: extractJSDocComment(lines, i),
            is_async: !!methodMatch[3],
            parameter_count: countParams(params),
            return_type: extractReturnType(trimmed),
          }
          entities.push(entity)

          // member_of edge
          edges.push({ from_id: entity.id, to_id: currentClass.id, kind: "member_of" })
        }
      }
    }
  }

  // Post-process: compute end_line and extract body for each entity
  fillEndLinesAndBodies(entities, lines)

  return { entities, edges }
}

/**
 * Compute end_line for entities using a second pass over the source,
 * then extract body text from the lines array.
 *
 * Strategy: sort entities by start_line, then for each entity find the
 * matching closing brace (or use next entity's start_line - 1 as fallback).
 */
function fillEndLinesAndBodies(entities: ParsedEntity[], lines: string[]): void {
  if (entities.length === 0) return

  // Sort by start_line so we can use next-entity as a boundary
  const sorted = [...entities].sort((a, b) => (a.start_line ?? 0) - (b.start_line ?? 0))

  for (let idx = 0; idx < sorted.length; idx++) {
    const entity = sorted[idx]!
    const startLine = entity.start_line
    if (startLine == null) continue

    // For type aliases and single-line declarations, find the end of the statement
    if (entity.kind === "type" || entity.kind === "enum" || entity.kind === "variable") {
      const endLine = findStatementEnd(lines, startLine - 1)
      entity.end_line = endLine + 1 // convert to 1-based
    } else {
      // For functions, classes, methods, interfaces: find matching brace
      const endLine = findMatchingBrace(lines, startLine - 1)
      entity.end_line = endLine + 1 // convert to 1-based
    }

    // Extract body (capped at MAX_BODY_LINES)
    const endIdx = (entity.end_line ?? startLine) - 1
    const bodyLines = lines.slice(startLine - 1, Math.min(endIdx + 1, startLine - 1 + MAX_BODY_LINES))
    if (bodyLines.length > 0) {
      entity.body = bodyLines.join("\n")
      // Estimate complexity for functions and methods
      if (entity.kind === "function" || entity.kind === "method") {
        entity.complexity = estimateComplexity(entity.body)
      }
    }
  }
}

/** Find the line index (0-based) of the matching closing brace for a block starting at lineIdx. */
function findMatchingBrace(lines: string[], lineIdx: number): number {
  let depth = 0
  let foundOpen = false

  for (let i = lineIdx; i < lines.length; i++) {
    const line = lines[i]!
    for (const ch of line) {
      if (ch === "{") {
        depth++
        foundOpen = true
      }
      if (ch === "}") {
        depth--
        if (foundOpen && depth === 0) return i
      }
    }
  }

  // Fallback: return start line itself if no match found
  return lineIdx
}

/** Find the end of a statement (type alias, variable) — either semicolon or next non-empty line. */
function findStatementEnd(lines: string[], lineIdx: number): number {
  let depth = 0
  for (let i = lineIdx; i < lines.length; i++) {
    const line = lines[i]!
    for (const ch of line) {
      if (ch === "{") depth++
      if (ch === "}") depth--
    }
    if (depth <= 0 && (line.includes(";") || (i > lineIdx && !line.trim().startsWith("|") && !line.trim().startsWith("&")))) {
      return i
    }
  }
  return lineIdx
}

/** Resolve a relative import path to an approximate file path. */
function resolveImportPath(currentFile: string, importSource: string): string {
  if (importSource.startsWith("@/") || importSource.startsWith("~/")) {
    // Alias import — strip prefix and treat as repo-root-relative
    return importSource.slice(2)
  }
  // Relative import — resolve against current file's directory
  const dir = currentFile.includes("/") ? currentFile.slice(0, currentFile.lastIndexOf("/")) : "."
  const parts = `${dir}/${importSource}`.split("/")
  const resolved: string[] = []
  for (const part of parts) {
    if (part === "..") resolved.pop()
    else if (part !== ".") resolved.push(part)
  }
  return resolved.join("/")
}

/** Count non-empty parameters from a parameter string. */
function countParams(params: string): number {
  if (!params.trim()) return 0
  return params.split(",").filter((p) => p.trim().length > 0).length
}

/** Extract return type from a function/method line. */
function extractReturnType(line: string): string | undefined {
  // Match ): ReturnType { or ): ReturnType => or ): ReturnType;
  const match = line.match(/\)\s*:\s*([^{=;]+)/)
  if (match) {
    const rt = match[1]!.trim()
    return rt.length > 0 && rt.length < 100 ? rt : undefined
  }
  return undefined
}

/** Estimate cyclomatic complexity from a code body. Baseline = 1. */
function estimateComplexity(body: string): number {
  let complexity = 1
  const pattern = /\b(if|else\s+if|for|while|case|catch)\b|\?\s*[^:?]|&&|\|\|/g
  let _match: RegExpExecArray | null
  while ((_match = pattern.exec(body)) !== null) {
    complexity++
  }
  return complexity
}

function detectLanguageFromPath(filePath: string): string {
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript"
  return "javascript"
}
