/**
 * Regex-based parser for Python source files.
 *
 * Extracts functions, classes, methods, and decorators from Python files
 * when SCIP indexing is unavailable.
 */
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
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

      if (currentClass && indent > currentClassIndent) {
        // Method
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
        }
        entities.push(entity)
        edges.push({ from_id: entity.id, to_id: currentClass.id, kind: "member_of" })
      } else {
        // Top-level function
        const sig = `def ${name}(${params})`
        const entity: ParsedEntity = {
          id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
          kind: "function",
          name,
          file_path: opts.filePath,
          start_line: lineNum,
          language: "python",
          signature: sig,
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

  return { entities, edges }
}
