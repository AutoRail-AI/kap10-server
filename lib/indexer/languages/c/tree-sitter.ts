/**
 * Regex-based parser for C source files.
 *
 * Extracts functions, structs, enums, typedefs, and global variables.
 */
import { extractJSDocComment } from "../../doc-extractor"
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import { MAX_BODY_LINES } from "../../types"
import type { TreeSitterOptions } from "../types"

export interface CParseResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

export function parseCFile(opts: TreeSitterOptions): CParseResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const lines = opts.content.split("\n")

  // Extract #include edges
  const fileId = entityHash(opts.repoId, opts.filePath, "file", opts.filePath)
  detectCIncludeEdges(lines, fileId, opts.repoId, edges)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue
    if (trimmed.startsWith("#")) continue // preprocessor directives

    // Struct declarations: struct Name {
    const structMatch = trimmed.match(/^(?:typedef\s+)?struct\s+(\w+)\s*\{?/)
    if (structMatch) {
      const name = structMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "struct", name),
        kind: "struct",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "c",
      })
      continue
    }

    // Enum declarations: enum Name {
    const enumMatch = trimmed.match(/^(?:typedef\s+)?enum\s+(\w+)\s*\{?/)
    if (enumMatch) {
      const name = enumMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "enum", name),
        kind: "enum",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "c",
      })
      continue
    }

    // Typedef: typedef existing_type new_name;
    const typedefMatch = trimmed.match(/^typedef\s+(?:struct|enum|union)?\s*\w+[\s*]+(\w+)\s*;/)
    if (typedefMatch) {
      const name = typedefMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "type", name),
        kind: "type",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "c",
      })
      continue
    }

    // Function declarations: return_type function_name(params) {
    const funcMatch = trimmed.match(
      /^(?:static\s+|inline\s+|extern\s+)*(?:const\s+)?(\w[\w\s*]+?)\s+(\w+)\s*\(([^)]*)\)\s*\{?\s*$/
    )
    if (funcMatch) {
      const returnType = funcMatch[1]!.trim()
      const name = funcMatch[2]!
      const params = funcMatch[3] ?? ""

      // Skip control flow and common non-function patterns
      if (["if", "for", "while", "switch", "return", "else", "do", "case"].includes(name)) continue
      if (["struct", "enum", "union", "typedef"].includes(returnType)) continue

      const sig = `${returnType} ${name}(${params})`
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
        kind: "function",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "c",
        signature: sig,
        parameter_count: countCParams(params),
        return_type: returnType,
      })
    }
  }

  fillCEndLinesAndBodies(entities, lines)
  detectCCallEdges(entities, edges)

  return { entities, edges }
}

function fillCEndLinesAndBodies(entities: ParsedEntity[], lines: string[]): void {
  for (const entity of entities) {
    const startLine = entity.start_line
    if (startLine == null) continue
    const startIdx = startLine - 1

    if (entity.kind === "type") {
      entity.end_line = startLine
      entity.body = lines[startIdx] ?? ""
      continue
    }

    let depth = 0
    let foundOpen = false
    let endIdx = startIdx

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i]!
      for (const ch of line) {
        if (ch === "{") { depth++; foundOpen = true }
        if (ch === "}") {
          depth--
          if (foundOpen && depth === 0) { endIdx = i; break }
        }
      }
      if (foundOpen && depth === 0) break
    }

    if (!foundOpen) endIdx = startIdx
    entity.end_line = endIdx + 1

    if (!entity.doc) {
      entity.doc = extractJSDocComment(lines, startIdx)
    }

    const bodyLines = lines.slice(startIdx, Math.min(endIdx + 1, startIdx + MAX_BODY_LINES))
    if (bodyLines.length > 0) {
      entity.body = bodyLines.join("\n")
      if (entity.kind === "function") {
        entity.complexity = estimateCComplexity(entity.body)
      }
    }
  }
}

function detectCCallEdges(entities: ParsedEntity[], edges: ParsedEdge[]): void {
  const callableMap = new Map<string, string>()
  for (const e of entities) {
    if (e.kind === "function") callableMap.set(e.name, e.id)
  }
  if (callableMap.size === 0) return

  const names = Array.from(callableMap.keys()).filter((n) => n.length > 1)
  if (names.length === 0) return

  const escapedNames = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const callPattern = new RegExp(`\\b(${escapedNames.join("|")})\\s*\\(`, "g")

  const edgeSet = new Set<string>()
  for (const entity of entities) {
    if (entity.kind !== "function" || !entity.body) continue
    const regex = new RegExp(callPattern.source, "g")
    let match: RegExpExecArray | null
    while ((match = regex.exec(entity.body)) !== null) {
      const calledName = match[1]!
      const calleeId = callableMap.get(calledName)
      if (calleeId && calleeId !== entity.id) {
        const edgeKey = `${entity.id}→${calleeId}`
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey)
          edges.push({ from_id: entity.id, to_id: calleeId, kind: "calls" })
        }
      }
    }
  }
}

function countCParams(params: string): number {
  if (!params.trim() || params.trim() === "void") return 0
  return params.split(",").filter((p) => p.trim().length > 0).length
}

function estimateCComplexity(body: string): number {
  let complexity = 1
  const pattern = /\b(if|else\s+if|for|while|do|case|switch)\b|&&|\|\||\?/g
  let _match: RegExpExecArray | null
  while ((_match = pattern.exec(body)) !== null) complexity++
  return complexity
}

function detectCIncludeEdges(
  lines: string[],
  fileId: string,
  repoId: string,
  edges: ParsedEdge[],
): void {
  for (const line of lines) {
    const trimmed = line.trim()
    // #include "local_header.h" (project-local includes)
    const localInclude = trimmed.match(/^#include\s+"([^"]+)"/)
    if (localInclude) {
      const includePath = localInclude[1]!
      const targetFileId = entityHash(repoId, includePath, "file", includePath)
      edges.push({
        from_id: fileId,
        to_id: targetFileId,
        kind: "imports",
        imported_symbols: [],
        import_type: "value",
        is_type_only: false,
      })
    }
    // #include <system_header.h> — skip (system headers)
  }
}
