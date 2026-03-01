/**
 * Regex-based parser for PHP source files.
 *
 * Extracts classes, interfaces, traits, functions, and methods.
 */
import { extractJSDocComment } from "../../doc-extractor"
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import { MAX_BODY_LINES } from "../../types"
import type { TreeSitterOptions } from "../types"

export interface PhpParseResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

export function parsePhpFile(opts: TreeSitterOptions): PhpParseResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const lines = opts.content.split("\n")

  const fileId = entityHash(opts.repoId, opts.filePath, "file", opts.filePath)
  detectPhpUseEdges(lines, fileId, opts.repoId, edges)

  let currentClass: ParsedEntity | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("#")) continue

    // Namespace: namespace App\Services;
    const nsMatch = trimmed.match(/^namespace\s+([\w\\]+)\s*;/)
    if (nsMatch) {
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "namespace", nsMatch[1]!),
        kind: "namespace",
        name: nsMatch[1]!,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "php",
      })
      continue
    }

    // Interface: [modifiers] interface Name [extends Base] {
    const ifaceMatch = trimmed.match(
      /^(?:(?:public|abstract)\s+)*interface\s+(\w+)(?:\s+extends\s+([\w\\,\s]+))?/
    )
    if (ifaceMatch) {
      const name = ifaceMatch[1]!
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "interface", name),
        kind: "interface",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "php",
      }
      entities.push(entity)
      currentClass = entity
      if (ifaceMatch[2]) {
        for (const base of ifaceMatch[2].split(",").map((s) => s.trim().split("\\").pop()!).filter(Boolean)) {
          const parentId = entityHash(opts.repoId, opts.filePath, "interface", base)
          edges.push({ from_id: entity.id, to_id: parentId, kind: "extends" })
        }
      }
      continue
    }

    // Trait: trait Name {
    const traitMatch = trimmed.match(/^trait\s+(\w+)/)
    if (traitMatch) {
      const name = traitMatch[1]!
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "class", name),
        kind: "class",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "php",
      }
      entities.push(entity)
      currentClass = entity
      continue
    }

    // Enum: enum Name [: string] [implements ...] {
    const enumMatch = trimmed.match(
      /^enum\s+(\w+)(?:\s*:\s*\w+)?(?:\s+implements\s+([\w\\,\s]+))?/
    )
    if (enumMatch) {
      const name = enumMatch[1]!
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "enum", name),
        kind: "enum",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "php",
      }
      entities.push(entity)
      currentClass = entity
      continue
    }

    // Class: [modifiers] class Name [extends Base] [implements ...] {
    const classMatch = trimmed.match(
      /^(?:(?:abstract|final|readonly)\s+)*class\s+(\w+)(?:\s+extends\s+([\w\\]+))?(?:\s+implements\s+([\w\\,\s]+))?/
    )
    if (classMatch) {
      const name = classMatch[1]!
      const extendsName = classMatch[2]?.split("\\").pop()
      const implementsList = classMatch[3]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "class", name),
        kind: "class",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "php",
      }
      entities.push(entity)
      currentClass = entity

      if (extendsName) {
        const parentId = entityHash(opts.repoId, opts.filePath, "class", extendsName)
        edges.push({ from_id: entity.id, to_id: parentId, kind: "extends" })
      }
      if (implementsList) {
        for (const iface of implementsList.split(",").map((s) => s.trim().split("\\").pop()!).filter(Boolean)) {
          const ifaceId = entityHash(opts.repoId, opts.filePath, "interface", iface)
          edges.push({ from_id: entity.id, to_id: ifaceId, kind: "implements" })
        }
      }
      continue
    }

    // Method/function: [modifiers] function name(params) [: ReturnType] {
    const funcMatch = trimmed.match(
      /^(?:(?:public|protected|private|static|abstract|final)\s+)*function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([\w\\?|]+))?/
    )
    if (funcMatch) {
      const name = funcMatch[1]!
      const params = funcMatch[2] ?? ""
      const returnType = funcMatch[3]

      if (currentClass) {
        const sig = `${currentClass.name}::${name}(${params})`
        const entity: ParsedEntity = {
          id: entityHash(opts.repoId, opts.filePath, "method", name, sig),
          kind: "method",
          name,
          file_path: opts.filePath,
          start_line: lineNum,
          language: "php",
          signature: sig,
          parent: currentClass.name,
          exported: trimmed.includes("public"),
          parameter_count: countPhpParams(params),
          return_type: returnType,
        }
        entities.push(entity)
        edges.push({ from_id: entity.id, to_id: currentClass.id, kind: "member_of" })
      } else {
        const sig = `function ${name}(${params})`
        entities.push({
          id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
          kind: "function",
          name,
          file_path: opts.filePath,
          start_line: lineNum,
          language: "php",
          signature: sig,
          parameter_count: countPhpParams(params),
          return_type: returnType,
        })
      }
    }
  }

  fillBraceMatchedBodies(entities, lines)
  detectCallEdges(entities, edges)

  return { entities, edges }
}

function countPhpParams(params: string): number {
  if (!params.trim()) return 0
  return params.split(",").filter((p) => p.trim().length > 0).length
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
      if (entity.kind === "function" || entity.kind === "method") {
        entity.complexity = estimateComplexity(entity.body)
      }
    }
  }
}

function estimateComplexity(body: string): number {
  let complexity = 1
  const pattern = /\b(if|elseif|for|foreach|while|do|case|catch|switch|match)\b|&&|\|\||\?\?|\?/g
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

function detectPhpUseEdges(
  lines: string[],
  fileId: string,
  repoId: string,
  edges: ParsedEdge[],
): void {
  for (const line of lines) {
    const trimmed = line.trim()
    // use App\Services\PaymentService;
    const useMatch = trimmed.match(/^use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/)
    if (useMatch) {
      const fqcn = useMatch[1]!
      const className = fqcn.split("\\").pop() ?? fqcn
      const filePath = fqcn.replace(/\\/g, "/") + ".php"
      const targetFileId = entityHash(repoId, filePath, "file", filePath)
      edges.push({
        from_id: fileId,
        to_id: targetFileId,
        kind: "imports",
        imported_symbols: [className],
        import_type: "value",
        is_type_only: false,
      })
    }
  }
}
