/**
 * Tree-sitter fallback parser for TypeScript/JavaScript.
 *
 * Extracts functions, classes, interfaces, methods, exports, and type aliases
 * from source files when SCIP indexing is unavailable or misses files.
 */
import { entityHash } from "../../entity-hash"
import type { EntityKind, ParsedEdge, ParsedEntity } from "../../types"
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
      const sig = `function ${name}(${funcMatch[6] ?? ""})`
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
        kind: "function",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: detectLanguageFromPath(opts.filePath),
        exported,
        signature: sig,
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
          const sig = `${currentClass.name}.${name}(${methodMatch[6] ?? ""})`
          const entity: ParsedEntity = {
            id: entityHash(opts.repoId, opts.filePath, "method", name, sig),
            kind: "method",
            name,
            file_path: opts.filePath,
            start_line: lineNum,
            language: detectLanguageFromPath(opts.filePath),
            signature: sig,
            parent: currentClass.name,
          }
          entities.push(entity)

          // member_of edge
          edges.push({ from_id: entity.id, to_id: currentClass.id, kind: "member_of" })
        }
      }
    }
  }

  return { entities, edges }
}

function detectLanguageFromPath(filePath: string): string {
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript"
  return "javascript"
}
