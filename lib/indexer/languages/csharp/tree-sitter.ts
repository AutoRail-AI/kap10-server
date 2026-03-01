/**
 * Regex-based parser for C# source files.
 *
 * Extracts classes, interfaces, enums, structs, records, methods, and properties.
 */
import { extractJSDocComment } from "../../doc-extractor"
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import { MAX_BODY_LINES } from "../../types"
import type { TreeSitterOptions } from "../types"

export interface CSharpParseResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

export function parseCSharpFile(opts: TreeSitterOptions): CSharpParseResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const lines = opts.content.split("\n")

  const fileId = entityHash(opts.repoId, opts.filePath, "file", opts.filePath)
  detectCSharpUsingEdges(lines, fileId, opts.repoId, edges)

  let currentNamespace = ""

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue

    // Namespace
    const nsMatch = trimmed.match(/^namespace\s+([\w.]+)/)
    if (nsMatch) {
      currentNamespace = nsMatch[1]!
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "namespace", currentNamespace),
        kind: "namespace",
        name: currentNamespace,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "csharp",
      })
      continue
    }

    // Interface: [modifiers] interface IName [: IBase] {
    const ifaceMatch = trimmed.match(
      /^(?:(?:public|internal|protected|private|partial)\s+)*interface\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([\w,\s<>.]+))?/
    )
    if (ifaceMatch) {
      const name = ifaceMatch[1]!
      const baseList = ifaceMatch[2]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "interface", name),
        kind: "interface",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "csharp",
        exported: trimmed.includes("public"),
      }
      entities.push(entity)
      if (baseList) {
        for (const base of baseList.split(",").map((s) => s.trim().replace(/<[^>]*>/g, "")).filter(Boolean)) {
          const parentId = entityHash(opts.repoId, opts.filePath, "interface", base)
          edges.push({ from_id: entity.id, to_id: parentId, kind: "extends" })
        }
      }
      continue
    }

    // Enum: [modifiers] enum Name {
    const enumMatch = trimmed.match(
      /^(?:(?:public|internal|protected|private)\s+)*enum\s+(\w+)/
    )
    if (enumMatch) {
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "enum", enumMatch[1]!),
        kind: "enum",
        name: enumMatch[1]!,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "csharp",
        exported: trimmed.includes("public"),
      })
      continue
    }

    // Struct: [modifiers] struct Name [: IInterface] {
    const structMatch = trimmed.match(
      /^(?:(?:public|internal|protected|private|partial|readonly|ref)\s+)*struct\s+(\w+)(?:<[^>]*>)?/
    )
    if (structMatch) {
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "struct", structMatch[1]!),
        kind: "struct",
        name: structMatch[1]!,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "csharp",
        exported: trimmed.includes("public"),
      })
      continue
    }

    // Record: [modifiers] record Name(params) {
    const recordMatch = trimmed.match(
      /^(?:(?:public|internal|protected|private|sealed|abstract|partial)\s+)*record\s+(?:struct\s+|class\s+)?(\w+)/
    )
    if (recordMatch) {
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "class", recordMatch[1]!),
        kind: "class",
        name: recordMatch[1]!,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "csharp",
        exported: trimmed.includes("public"),
      })
      continue
    }

    // Class: [modifiers] class Name [: Base, IInterface] {
    const classMatch = trimmed.match(
      /^(?:(?:public|internal|protected|private|static|sealed|abstract|partial)\s+)*class\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([\w,\s<>.]+))?/
    )
    if (classMatch) {
      const name = classMatch[1]!
      const baseList = classMatch[2]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "class", name),
        kind: "class",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "csharp",
        exported: trimmed.includes("public"),
      }
      entities.push(entity)
      if (baseList) {
        for (const base of baseList.split(",").map((s) => s.trim().replace(/<[^>]*>/g, "")).filter(Boolean)) {
          const isInterface = base.startsWith("I") && base.length > 1 && base[1] === base[1]!.toUpperCase()
          const kind = isInterface ? "implements" : "extends"
          const parentKind = isInterface ? "interface" : "class"
          const parentId = entityHash(opts.repoId, opts.filePath, parentKind, base)
          edges.push({ from_id: entity.id, to_id: parentId, kind })
        }
      }
      continue
    }

    // Method: [modifiers] ReturnType MethodName(params) {
    const methodMatch = trimmed.match(
      /^(?:(?:public|internal|protected|private|static|virtual|override|abstract|async|new|sealed|extern|partial)\s+)*([\w<>\[\]?,\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:where\s+\w+\s*:\s*[\w,\s]+)?\s*[{;=]/
    )
    if (methodMatch) {
      const returnType = methodMatch[1]!.trim()
      const name = methodMatch[2]!
      const params = methodMatch[3] ?? ""

      if (["class", "interface", "enum", "struct", "record", "namespace", "if", "for", "while", "switch"].includes(name)) continue
      if (["class", "interface", "enum", "struct", "record", "namespace"].includes(returnType)) continue

      const sig = `${returnType} ${name}(${params})`
      const isAsync = trimmed.includes("async ")
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "method", name, sig),
        kind: "method",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "csharp",
        signature: sig,
        exported: trimmed.includes("public"),
        is_async: isAsync || undefined,
        parameter_count: countCSharpParams(params),
        return_type: returnType,
      }
      entities.push(entity)

      const enclosingClass = findEnclosing(entities, lineNum)
      if (enclosingClass) {
        entity.parent = enclosingClass.name
        edges.push({ from_id: entity.id, to_id: enclosingClass.id, kind: "member_of" })
      }
    }
  }

  fillBraceMatchedBodies(entities, lines)
  detectCallEdges(entities, edges)

  return { entities, edges }
}

function findEnclosing(entities: ParsedEntity[], lineNum: number): ParsedEntity | undefined {
  let best: ParsedEntity | undefined
  let bestLine = 0
  for (const e of entities) {
    if ((e.kind === "class" || e.kind === "struct" || e.kind === "interface") &&
        e.start_line != null && e.start_line < lineNum && e.start_line > bestLine) {
      best = e
      bestLine = e.start_line
    }
  }
  return best
}

function countCSharpParams(params: string): number {
  if (!params.trim()) return 0
  let depth = 0
  let count = 1
  for (const ch of params) {
    if (ch === "<") depth++
    else if (ch === ">") depth--
    else if (ch === "," && depth === 0) count++
  }
  return count
}

function fillBraceMatchedBodies(entities: ParsedEntity[], lines: string[]): void {
  for (const entity of entities) {
    const startLine = entity.start_line
    if (startLine == null) continue
    const startIdx = startLine - 1

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
      if (entity.kind === "method") {
        entity.complexity = estimateComplexity(entity.body)
      }
    }
  }
}

function estimateComplexity(body: string): number {
  let complexity = 1
  const pattern = /\b(if|else\s+if|for|foreach|while|do|case|catch|switch)\b|&&|\|\||\?\?|\?/g
  let _match: RegExpExecArray | null
  while ((_match = pattern.exec(body)) !== null) complexity++
  return complexity
}

function detectCallEdges(entities: ParsedEntity[], edges: ParsedEdge[]): void {
  const callableMap = new Map<string, string>()
  for (const e of entities) {
    if (e.kind === "method") callableMap.set(e.name, e.id)
  }
  if (callableMap.size === 0) return

  const names = Array.from(callableMap.keys()).filter((n) => n.length > 1)
  if (names.length === 0) return

  const escapedNames = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const callPattern = new RegExp(`\\b(${escapedNames.join("|")})\\s*\\(`, "g")

  const edgeSet = new Set<string>()
  for (const entity of entities) {
    if (entity.kind !== "method" || !entity.body) continue
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

function detectCSharpUsingEdges(
  lines: string[],
  fileId: string,
  repoId: string,
  edges: ParsedEdge[],
): void {
  for (const line of lines) {
    const trimmed = line.trim()
    // using System.Collections.Generic;
    const usingMatch = trimmed.match(/^using\s+(?:static\s+)?([\w.]+)\s*;/)
    if (usingMatch) {
      const ns = usingMatch[1]!
      // Skip System.* (standard library)
      if (ns.startsWith("System") || ns.startsWith("Microsoft")) continue

      const targetFileId = entityHash(repoId, ns.replace(/\./g, "/"), "file", ns)
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
