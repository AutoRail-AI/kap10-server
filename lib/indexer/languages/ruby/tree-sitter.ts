/**
 * Regex-based parser for Ruby source files.
 *
 * Extracts classes, modules, methods, and attributes.
 */
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import { MAX_BODY_LINES } from "../../types"
import type { TreeSitterOptions } from "../types"

export interface RubyParseResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

export function parseRubyFile(opts: TreeSitterOptions): RubyParseResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const lines = opts.content.split("\n")

  const fileId = entityHash(opts.repoId, opts.filePath, "file", opts.filePath)
  detectRubyRequireEdges(lines, fileId, opts.repoId, edges)

  let currentClass: ParsedEntity | null = null
  let currentClassIndent = -1
  let currentModule: ParsedEntity | null = null
  let currentModuleIndent = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("#")) continue

    const indent = line.length - line.trimStart().length

    // Exit class/module scope if indentation decreases
    if (currentClass && indent <= currentClassIndent && trimmed === "end") {
      currentClass = null
      currentClassIndent = -1
    }
    if (currentModule && indent <= currentModuleIndent && trimmed === "end") {
      currentModule = null
      currentModuleIndent = -1
    }

    // Module: module Name
    const moduleMatch = trimmed.match(/^module\s+([\w:]+)/)
    if (moduleMatch) {
      const name = moduleMatch[1]!
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "namespace", name),
        kind: "namespace",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "ruby",
      }
      entities.push(entity)
      currentModule = entity
      currentModuleIndent = indent
      continue
    }

    // Class: class Name [< Base]
    const classMatch = trimmed.match(/^class\s+([\w:]+)(?:\s*<\s*([\w:]+))?/)
    if (classMatch) {
      const name = classMatch[1]!
      const baseName = classMatch[2]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "class", name),
        kind: "class",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "ruby",
      }
      entities.push(entity)
      currentClass = entity
      currentClassIndent = indent

      if (baseName) {
        const parentId = entityHash(opts.repoId, opts.filePath, "class", baseName)
        edges.push({ from_id: entity.id, to_id: parentId, kind: "extends" })
      }
      if (currentModule) {
        edges.push({ from_id: entity.id, to_id: currentModule.id, kind: "member_of" })
      }
      continue
    }

    // Method: def method_name(params) / def self.method_name(params)
    const methodMatch = trimmed.match(/^def\s+(?:self\.)?(\w+[?!=]?)\s*(?:\(([^)]*)\))?/)
    if (methodMatch) {
      const name = methodMatch[1]!
      const params = methodMatch[2] ?? ""
      const isClassMethod = trimmed.includes("def self.")

      if (currentClass) {
        const sig = `${currentClass.name}#${name}(${params})`
        const entity: ParsedEntity = {
          id: entityHash(opts.repoId, opts.filePath, "method", name, sig),
          kind: "method",
          name,
          file_path: opts.filePath,
          start_line: lineNum,
          language: "ruby",
          signature: sig,
          parent: currentClass.name,
          exported: !name.startsWith("_"),
          parameter_count: countRubyParams(params),
        }
        entities.push(entity)
        edges.push({ from_id: entity.id, to_id: currentClass.id, kind: "member_of" })
      } else {
        const sig = `def ${name}(${params})`
        entities.push({
          id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
          kind: "function",
          name,
          file_path: opts.filePath,
          start_line: lineNum,
          language: "ruby",
          signature: sig,
          parameter_count: countRubyParams(params),
        })
      }
    }
  }

  fillRubyEndLinesAndBodies(entities, lines)
  detectCallEdges(entities, edges)

  return { entities, edges }
}

function countRubyParams(params: string): number {
  if (!params.trim()) return 0
  return params.split(",").filter((p) => p.trim().length > 0 && !p.trim().startsWith("&")).length
}

/**
 * Compute end_line for Ruby entities using `end` keyword matching.
 */
function fillRubyEndLinesAndBodies(entities: ParsedEntity[], lines: string[]): void {
  for (const entity of entities) {
    const startLine = entity.start_line
    if (startLine == null) continue
    const startIdx = startLine - 1
    const defLine = lines[startIdx]
    if (!defLine) continue

    const baseIndent = defLine.length - defLine.trimStart().length
    let endIdx = startIdx

    // Find matching `end` at the same indentation level
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i]!
      const trimmed = line.trim()
      if (!trimmed) continue

      const indent = line.length - line.trimStart().length
      if (indent === baseIndent && trimmed === "end") {
        endIdx = i
        break
      }
    }

    entity.end_line = endIdx + 1

    // Extract comment above the entity (Ruby uses #)
    if (!entity.doc) {
      entity.doc = extractRubyComment(lines, startIdx)
    }

    const bodyLines = lines.slice(startIdx, Math.min(endIdx + 1, startIdx + MAX_BODY_LINES))
    if (bodyLines.length > 0) {
      entity.body = bodyLines.join("\n")
      if (entity.kind === "function" || entity.kind === "method") {
        entity.complexity = estimateRubyComplexity(entity.body)
      }
    }
  }
}

function extractRubyComment(lines: string[], entityLineIdx: number): string | undefined {
  if (entityLineIdx <= 0) return undefined
  let i = entityLineIdx - 1
  while (i >= 0 && !lines[i]!.trim()) i--
  if (i < 0) return undefined

  const currentLine = lines[i]!.trim()
  if (!currentLine.startsWith("#")) return undefined

  const endIdx = i
  while (i > 0 && lines[i - 1]!.trim().startsWith("#")) i--

  const cleaned = lines.slice(i, endIdx + 1)
    .map((l) => l.trim().replace(/^#\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim()

  return cleaned.length >= 10 ? cleaned : undefined
}

function estimateRubyComplexity(body: string): number {
  let complexity = 1
  const pattern = /\b(if|elsif|unless|for|while|until|when|rescue)\b|&&|\|\|/g
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
  const callPattern = new RegExp(`\\b(${escapedNames.join("|")})(?:\\s*\\(|\\s+\\w)`, "g")

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

function detectRubyRequireEdges(
  lines: string[],
  fileId: string,
  repoId: string,
  edges: ParsedEdge[],
): void {
  for (const line of lines) {
    const trimmed = line.trim()
    // require_relative './models/user'
    const relMatch = trimmed.match(/^require_relative\s+['"]([^'"]+)['"]/)
    if (relMatch) {
      const reqPath = relMatch[1]!
      const targetFileId = entityHash(repoId, reqPath, "file", reqPath)
      edges.push({
        from_id: fileId,
        to_id: targetFileId,
        kind: "imports",
        imported_symbols: [],
        import_type: "value",
        is_type_only: false,
      })
    }
    // require 'gem_name' — external, skip for now
  }
}
