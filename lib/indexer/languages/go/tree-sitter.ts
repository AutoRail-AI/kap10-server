/**
 * Regex-based parser for Go source files.
 *
 * Extracts functions, structs, interfaces, and methods from Go files.
 */
import { extractGoDocComment } from "../../doc-extractor"
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import { MAX_BODY_LINES } from "../../types"
import type { TreeSitterOptions } from "../types"

export interface GoParseResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

export function parseGoFile(opts: TreeSitterOptions): GoParseResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const lines = opts.content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("//")) continue

    // Function declarations: func FuncName(params) returnType {
    const funcMatch = trimmed.match(/^func\s+(\w+)\s*\(([^)]*)\)/)
    if (funcMatch) {
      const name = funcMatch[1]!
      const params = funcMatch[2] ?? ""
      const sig = `func ${name}(${params})`
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
        kind: "function",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "go",
        signature: sig,
        exported: name[0] === name[0]!.toUpperCase(),
        parameter_count: countGoParams(params),
        return_type: extractGoReturnType(trimmed),
      })
      continue
    }

    // Method declarations: func (r *Receiver) MethodName(params) returnType {
    const methodMatch = trimmed.match(/^func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(([^)]*)\)/)
    if (methodMatch) {
      const receiverType = methodMatch[2]!
      const name = methodMatch[3]!
      const params = methodMatch[4] ?? ""
      const sig = `(${receiverType}).${name}(${params})`
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "method", name, sig),
        kind: "method",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "go",
        signature: sig,
        parent: receiverType,
        exported: name[0] === name[0]!.toUpperCase(),
        parameter_count: countGoParams(params),
        return_type: extractGoReturnType(trimmed),
      }
      entities.push(entity)

      // member_of edge to struct
      const structId = entityHash(opts.repoId, opts.filePath, "struct", receiverType)
      edges.push({ from_id: entity.id, to_id: structId, kind: "member_of" })
      continue
    }

    // Struct declarations: type StructName struct {
    const structMatch = trimmed.match(/^type\s+(\w+)\s+struct\s*\{?/)
    if (structMatch) {
      const name = structMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "struct", name),
        kind: "struct",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "go",
        exported: name[0] === name[0]!.toUpperCase(),
      })
      continue
    }

    // Interface declarations: type InterfaceName interface {
    const ifaceMatch = trimmed.match(/^type\s+(\w+)\s+interface\s*\{?/)
    if (ifaceMatch) {
      const name = ifaceMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "interface", name),
        kind: "interface",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "go",
        exported: name[0] === name[0]!.toUpperCase(),
      })
      continue
    }

    // Type alias: type TypeName = ...  or  type TypeName OtherType
    const typeMatch = trimmed.match(/^type\s+(\w+)\s+(?!=struct|interface)\w/)
    if (typeMatch && !trimmed.includes(" struct") && !trimmed.includes(" interface")) {
      const name = typeMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "type", name),
        kind: "type",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "go",
        exported: name[0] === name[0]!.toUpperCase(),
      })
    }
  }

  // Post-process: compute end_line and extract body for each entity
  fillGoEndLinesAndBodies(entities, lines)

  return { entities, edges }
}

/**
 * Compute end_line for Go entities using brace matching,
 * then extract body text.
 */
function fillGoEndLinesAndBodies(entities: ParsedEntity[], lines: string[]): void {
  if (entities.length === 0) return

  for (const entity of entities) {
    const startLine = entity.start_line
    if (startLine == null) continue
    const startIdx = startLine - 1

    if (entity.kind === "type") {
      // Type aliases are single-line
      entity.end_line = startLine
      entity.body = lines[startIdx] ?? ""
      continue
    }

    // For func, method, struct, interface: find matching closing brace
    let depth = 0
    let foundOpen = false
    let endIdx = startIdx

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i]!
      for (const ch of line) {
        if (ch === "{") {
          depth++
          foundOpen = true
        }
        if (ch === "}") {
          depth--
          if (foundOpen && depth === 0) {
            endIdx = i
            break
          }
        }
      }
      if (foundOpen && depth === 0) break
    }

    // Fallback: if no brace found, it's a single-line declaration
    if (!foundOpen) endIdx = startIdx

    entity.end_line = endIdx + 1 // 1-based

    // Extract doc comment (Go-style // comments)
    if (!entity.doc) {
      entity.doc = extractGoDocComment(lines, startIdx)
    }

    // Extract body (capped at MAX_BODY_LINES)
    const bodyLines = lines.slice(startIdx, Math.min(endIdx + 1, startIdx + MAX_BODY_LINES))
    if (bodyLines.length > 0) {
      entity.body = bodyLines.join("\n")
      // Estimate complexity for functions and methods
      if (entity.kind === "function" || entity.kind === "method") {
        entity.complexity = estimateGoComplexity(entity.body)
      }
    }
  }
}

/** Count Go function parameters. */
function countGoParams(params: string): number {
  if (!params.trim()) return 0
  return params.split(",").filter((p) => p.trim().length > 0).length
}

/** Extract Go return type from a func declaration line. */
function extractGoReturnType(line: string): string | undefined {
  // Match after closing paren, before opening brace: func Foo(x int) (string, error) {
  const match = line.match(/\)\s*([^{]+)\s*\{?\s*$/)
  if (match) {
    const rt = match[1]!.trim()
    return rt.length > 0 && rt.length < 100 ? rt : undefined
  }
  return undefined
}

/** Estimate cyclomatic complexity for Go. Baseline = 1. */
function estimateGoComplexity(body: string): number {
  let complexity = 1
  const pattern = /\b(if|else\s+if|for|case|select)\b|&&|\|\|/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    complexity++
  }
  return complexity
}
