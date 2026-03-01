/**
 * Regex-based parser for C++ source files.
 *
 * Extracts functions, classes, structs, enums, namespaces, and methods.
 */
import { extractJSDocComment } from "../../doc-extractor"
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import { MAX_BODY_LINES } from "../../types"
import type { TreeSitterOptions } from "../types"

export interface CppParseResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

export function parseCppFile(opts: TreeSitterOptions): CppParseResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const lines = opts.content.split("\n")

  const fileId = entityHash(opts.repoId, opts.filePath, "file", opts.filePath)
  detectCppIncludeEdges(lines, fileId, opts.repoId, edges)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue
    if (trimmed.startsWith("#")) continue

    // Namespace: namespace Name {
    const nsMatch = trimmed.match(/^namespace\s+(\w+)\s*\{?/)
    if (nsMatch) {
      const name = nsMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "namespace", name),
        kind: "namespace",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "cpp",
      })
      continue
    }

    // Class declarations: [template<...>] class Name [: public Base] {
    const classMatch = trimmed.match(
      /^(?:template\s*<[^>]*>\s+)?class\s+(\w+)(?:\s*:\s*(?:public|protected|private)\s+(\w+))?/
    )
    if (classMatch) {
      const name = classMatch[1]!
      const baseName = classMatch[2]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "class", name),
        kind: "class",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "cpp",
      }
      entities.push(entity)
      if (baseName) {
        const parentId = entityHash(opts.repoId, opts.filePath, "class", baseName)
        edges.push({ from_id: entity.id, to_id: parentId, kind: "extends" })
      }
      continue
    }

    // Struct declarations
    const structMatch = trimmed.match(/^(?:typedef\s+)?struct\s+(\w+)\s*(?::\s*(?:public|protected|private)\s+\w+)?\s*\{?/)
    if (structMatch) {
      const name = structMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "struct", name),
        kind: "struct",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "cpp",
      })
      continue
    }

    // Enum declarations: enum [class] Name {
    const enumMatch = trimmed.match(/^enum\s+(?:class\s+)?(\w+)\s*(?::\s*\w+)?\s*\{?/)
    if (enumMatch) {
      const name = enumMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "enum", name),
        kind: "enum",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "cpp",
      })
      continue
    }

    // Method: ReturnType ClassName::MethodName(params) {
    const methodMatch = trimmed.match(
      /^(?:[\w:*&<>\s]+?)\s+(\w+)::(\w+)\s*\(([^)]*)\)/
    )
    if (methodMatch) {
      const className = methodMatch[1]!
      const name = methodMatch[2]!
      const params = methodMatch[3] ?? ""
      const sig = `${className}::${name}(${params})`
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "method", name, sig),
        kind: "method",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "cpp",
        signature: sig,
        parent: className,
        parameter_count: countCParams(params),
      }
      entities.push(entity)
      const classId = entityHash(opts.repoId, opts.filePath, "class", className)
      edges.push({ from_id: entity.id, to_id: classId, kind: "member_of" })
      continue
    }

    // Free function: return_type function_name(params) {
    const funcMatch = trimmed.match(
      /^(?:static\s+|inline\s+|extern\s+|virtual\s+|constexpr\s+)*(?:const\s+)?(\w[\w\s*&<>]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?(?:override\s*)?(?:final\s*)?(?:noexcept\s*)?(?:=\s*\w+\s*)?\{?\s*$/
    )
    if (funcMatch) {
      const returnType = funcMatch[1]!.trim()
      const name = funcMatch[2]!
      const params = funcMatch[3] ?? ""

      if (["if", "for", "while", "switch", "return", "else", "do", "case", "class", "struct", "enum", "namespace"].includes(name)) continue

      const sig = `${returnType} ${name}(${params})`
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
        kind: "function",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "cpp",
        signature: sig,
        parameter_count: countCParams(params),
        return_type: returnType,
      })
    }
  }

  fillBraceMatchedBodies(entities, lines, "cpp")
  detectCallEdges(entities, edges)

  return { entities, edges }
}

function countCParams(params: string): number {
  if (!params.trim() || params.trim() === "void") return 0
  let depth = 0
  let count = 1
  for (const ch of params) {
    if (ch === "<") depth++
    else if (ch === ">") depth--
    else if (ch === "," && depth === 0) count++
  }
  return count
}

function fillBraceMatchedBodies(entities: ParsedEntity[], lines: string[], language: string): void {
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

    if (!entity.doc) entity.doc = extractJSDocComment(lines, startIdx)

    const bodyLines = lines.slice(startIdx, Math.min(endIdx + 1, startIdx + MAX_BODY_LINES))
    if (bodyLines.length > 0) {
      entity.body = bodyLines.join("\n")
      if (entity.kind === "function" || entity.kind === "method") {
        entity.complexity = estimateCppComplexity(entity.body)
      }
    }
  }
}

function estimateCppComplexity(body: string): number {
  let complexity = 1
  const pattern = /\b(if|else\s+if|for|while|do|case|switch|catch)\b|&&|\|\||\?/g
  let _match: RegExpExecArray | null
  while ((_match = pattern.exec(body)) !== null) complexity++
  return complexity
}

function detectCallEdges(entities: ParsedEntity[], edges: ParsedEdge[]): void {
  const callableMap = new Map<string, string>()
  for (const e of entities) {
    if (e.kind === "function" || e.kind === "method") callableMap.set(e.name, e.id)
  }
  if (callableMap.size === 0) return

  const names = Array.from(callableMap.keys()).filter((n) => n.length > 1)
  if (names.length === 0) return

  const escapedNames = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const callPattern = new RegExp(`\\b(${escapedNames.join("|")})\\s*\\(`, "g")

  const edgeSet = new Set<string>()
  for (const entity of entities) {
    if (entity.kind !== "function" && entity.kind !== "method") continue
    if (!entity.body) continue
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

function detectCppIncludeEdges(
  lines: string[],
  fileId: string,
  repoId: string,
  edges: ParsedEdge[],
): void {
  for (const line of lines) {
    const trimmed = line.trim()
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
  }
}
