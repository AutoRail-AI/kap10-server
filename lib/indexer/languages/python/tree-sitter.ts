/**
 * Regex-based parser for Python source files.
 *
 * Extracts functions, classes, methods, and decorators from Python files
 * when SCIP indexing is unavailable.
 */
import { extractPythonDocstring } from "../../doc-extractor"
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import { MAX_BODY_LINES } from "../../types"
import type { TreeSitterOptions } from "../types"

export interface PythonParseResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

/**
 * Parse a Python file to extract structural entities.
 */
export function parsePythonFile(opts: TreeSitterOptions): PythonParseResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const lines = opts.content.split("\n")

  let currentClass: ParsedEntity | null = null
  let currentClassIndent = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue

    // Calculate indentation
    const indent = line.length - line.trimStart().length

    // If we're back to class-level or less indentation, exit class scope
    if (currentClass && indent <= currentClassIndent) {
      currentClass = null
      currentClassIndent = -1
    }

    // Class declarations
    const classMatch = trimmed.match(/^class\s+(\w+)(?:\(([^)]*)\))?\s*:/)
    if (classMatch) {
      const name = classMatch[1]!
      const bases = classMatch[2]
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "class", name),
        kind: "class",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "python",
      }
      entities.push(entity)
      currentClass = entity
      currentClassIndent = indent

      // Create extends edges for base classes
      if (bases) {
        for (const base of bases.split(",")) {
          const baseName = base.trim().split("(")[0]!.split("[")[0]!.trim()
          if (baseName && baseName !== "object" && baseName !== "ABC") {
            const parentId = entityHash(opts.repoId, opts.filePath, "class", baseName)
            edges.push({ from_id: entity.id, to_id: parentId, kind: "extends" })
          }
        }
      }
      continue
    }

    // Function/method declarations
    const funcMatch = trimmed.match(/^(async\s+)?def\s+(\w+)\s*\(([^)]*)\)/)
    if (funcMatch) {
      const name = funcMatch[2]!
      const params = funcMatch[3] ?? ""
      const isAsync = !!funcMatch[1]
      const returnTypeMatch = trimmed.match(/\)\s*->\s*([^:]+):/)
      const returnType = returnTypeMatch ? returnTypeMatch[1]!.trim() : undefined

      if (currentClass && indent > currentClassIndent) {
        // Method — exclude self/cls from parameter count
        const paramCount = countPythonParams(params)
        const sig = `${currentClass.name}.${name}(${params})`
        const entity: ParsedEntity = {
          id: entityHash(opts.repoId, opts.filePath, "method", name, sig),
          kind: "method",
          name,
          file_path: opts.filePath,
          start_line: lineNum,
          language: "python",
          signature: sig,
          parent: currentClass.name,
          is_async: isAsync,
          parameter_count: paramCount,
          return_type: returnType,
        }
        entities.push(entity)
        edges.push({ from_id: entity.id, to_id: currentClass.id, kind: "member_of" })
      } else {
        // Top-level function
        const paramCount = countPythonParams(params)
        const sig = `def ${name}(${params})`
        const entity: ParsedEntity = {
          id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
          kind: "function",
          name,
          file_path: opts.filePath,
          start_line: lineNum,
          language: "python",
          signature: sig,
          is_async: isAsync,
          parameter_count: paramCount,
          return_type: returnType,
        }
        entities.push(entity)
      }
      continue
    }

    // Decorator detection (mark the next function/class)
    if (trimmed.startsWith("@")) {
      const decoratorMatch = trimmed.match(/^@(\w+(?:\.\w+)*)/)
      if (decoratorMatch) {
        const name = decoratorMatch[1]!
        entities.push({
          id: entityHash(opts.repoId, opts.filePath, "decorator", name, `@${name}:${lineNum}`),
          kind: "decorator",
          name,
          file_path: opts.filePath,
          start_line: lineNum,
          language: "python",
        })
      }
    }
  }

  // Post-process: compute end_line and extract body for each entity
  fillPythonEndLinesAndBodies(entities, lines)

  // Post-process: detect call edges by scanning function/method bodies
  detectPythonCallEdges(entities, edges)

  return { entities, edges }
}

/**
 * Compute end_line for Python entities using indentation-based scoping,
 * then extract body text.
 */
function fillPythonEndLinesAndBodies(entities: ParsedEntity[], lines: string[]): void {
  if (entities.length === 0) return

  for (const entity of entities) {
    const startLine = entity.start_line
    if (startLine == null) continue

    // Decorators are single-line
    if (entity.kind === "decorator") {
      entity.end_line = startLine
      entity.body = lines[startLine - 1] ?? ""
      continue
    }

    // For classes, functions, methods: find end by indentation
    const startIdx = startLine - 1
    const defLine = lines[startIdx]
    if (!defLine) continue

    const baseIndent = defLine.length - defLine.trimStart().length
    let endIdx = startIdx

    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i]!
      const trimmed = line.trim()

      // Skip blank lines and comments
      if (!trimmed || trimmed.startsWith("#")) {
        endIdx = i
        continue
      }

      const indent = line.length - line.trimStart().length
      if (indent <= baseIndent) break // back to same or less indentation
      endIdx = i
    }

    entity.end_line = endIdx + 1 // 1-based

    // Extract doc comment (Python docstring)
    if (!entity.doc) {
      entity.doc = extractPythonDocstring(lines, startIdx)
    }

    // Extract body (capped at MAX_BODY_LINES)
    const bodyLines = lines.slice(startIdx, Math.min(endIdx + 1, startIdx + MAX_BODY_LINES))
    if (bodyLines.length > 0) {
      entity.body = bodyLines.join("\n")
      // Estimate complexity for functions and methods
      if (entity.kind === "function" || entity.kind === "method") {
        entity.complexity = estimatePythonComplexity(entity.body)
      }
    }
  }
}

/**
 * Detect call edges by scanning function/method bodies for `name(` patterns
 * matching known entity names in the same file.
 */
function detectPythonCallEdges(entities: ParsedEntity[], edges: ParsedEdge[]): void {
  // Build a set of callable entity names → IDs
  const callableMap = new Map<string, string>()
  for (const e of entities) {
    if (e.kind === "function" || e.kind === "method" || e.kind === "class") {
      callableMap.set(e.name, e.id)
    }
  }

  if (callableMap.size === 0) return

  // Build a regex matching any callable name followed by (
  const names = Array.from(callableMap.keys()).filter((n) => n.length > 1)
  if (names.length === 0) return

  // Escape regex special chars in names, match word boundary + name + (
  const escapedNames = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const callPattern = new RegExp(`\\b(${escapedNames.join("|")})\\s*\\(`, "g")

  const edgeSet = new Set<string>()
  for (const entity of entities) {
    if (entity.kind !== "function" && entity.kind !== "method") continue
    if (!entity.body) continue

    let match: RegExpExecArray | null
    const regex = new RegExp(callPattern.source, "g")
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

/** Count parameters excluding self/cls. */
function countPythonParams(params: string): number {
  if (!params.trim()) return 0
  const parts = params.split(",").map((p) => p.trim()).filter(Boolean)
  return parts.filter((p) => p !== "self" && p !== "cls" && !p.startsWith("*")).length
}

/** Estimate cyclomatic complexity for Python. Baseline = 1. */
function estimatePythonComplexity(body: string): number {
  let complexity = 1
  const pattern = /\b(if|elif|for|while|except|and|or)\b/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    complexity++
  }
  return complexity
}
