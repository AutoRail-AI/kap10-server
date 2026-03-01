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

  // First pass: extract import edges for internal Go imports
  const fileId = entityHash(opts.repoId, opts.filePath, "file", opts.filePath)
  detectGoImportEdges(lines, fileId, opts.filePath, opts.repoId, edges)

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
    const methodMatch = trimmed.match(/^func\s+\((\w+)\s+(\*?\w+)\)\s+(\w+)\s*\(([^)]*)\)/)
    if (methodMatch) {
      const receiverFull = methodMatch[2]!
      const isPointerReceiver = receiverFull.startsWith("*")
      const receiverType = isPointerReceiver ? receiverFull.slice(1) : receiverFull
      const name = methodMatch[3]!
      const params = methodMatch[4] ?? ""
      // C-04: Preserve pointer receiver flag in method signature
      const receiverSig = isPointerReceiver ? `*${receiverType}` : receiverType
      const sig = `(${receiverSig}).${name}(${params})`
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

  // Post-process: detect call edges by scanning function/method bodies
  detectGoCallEdges(entities, edges)

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

/**
 * Detect call edges by scanning function/method bodies for `name(` patterns
 * matching known entity names in the same file.
 */
function detectGoCallEdges(entities: ParsedEntity[], edges: ParsedEdge[]): void {
  // Build a set of callable entity names → IDs
  const callableMap = new Map<string, string>()
  for (const e of entities) {
    if (e.kind === "function" || e.kind === "method") {
      callableMap.set(e.name, e.id)
    }
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
  let _match: RegExpExecArray | null
  while ((_match = pattern.exec(body)) !== null) {
    complexity++
  }
  return complexity
}

/**
 * Go standard library packages — used to exclude external imports.
 * Covers the most common stdlib packages. Go stdlib packages are
 * single-segment (no dots or slashes in the first path element).
 */
const GO_STDLIB_PREFIXES = new Set([
  "archive", "bufio", "bytes", "compress", "container", "context",
  "crypto", "database", "debug", "embed", "encoding", "errors",
  "expvar", "flag", "fmt", "go", "hash", "html", "image", "index",
  "io", "log", "maps", "math", "mime", "net", "os", "path",
  "plugin", "reflect", "regexp", "runtime", "slices", "sort",
  "strconv", "strings", "sync", "syscall", "testing", "text",
  "time", "unicode", "unsafe",
])

/**
 * Detect Go import edges.
 *
 * Handles both single-line and grouped imports:
 *   - `import "fmt"`
 *   - `import ( "fmt"  "strings"  "myproject/internal/utils" )`
 *
 * Heuristic for internal imports: An import is internal if its path
 * contains at least one "/" AND the first path segment is NOT a known
 * Go stdlib package. This captures `github.com/org/repo/pkg/...` and
 * `myproject/internal/...` patterns. The target file path is derived
 * from the import path suffix (last 2+ path segments) to create a
 * best-effort file-level edge.
 */
function detectGoImportEdges(
  lines: string[],
  fileId: string,
  filePath: string,
  repoId: string,
  edges: ParsedEdge[],
): void {
  let inImportBlock = false
  const importPaths: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Single import: import "path"
    const singleMatch = trimmed.match(/^import\s+"([^"]+)"/)
    if (singleMatch) {
      importPaths.push(singleMatch[1]!)
      continue
    }

    // Start of import block: import (
    if (trimmed.match(/^import\s*\(/)) {
      inImportBlock = true
      continue
    }

    // End of import block
    if (inImportBlock && trimmed === ")") {
      inImportBlock = false
      continue
    }

    // Inside import block: "path" or alias "path"
    if (inImportBlock) {
      const blockMatch = trimmed.match(/(?:\w+\s+)?"([^"]+)"/)
      if (blockMatch) {
        importPaths.push(blockMatch[1]!)
      }
    }
  }

  // Infer the module prefix from the current file's import context.
  // Go files within a project share a common module prefix (from go.mod).
  // We detect the repo's directory prefix from the file path and use it
  // to identify which imports point back into the same repo.
  const fileDir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : ""

  for (const importPath of importPaths) {
    // Skip standard library (no "/" means single-segment = stdlib)
    if (!importPath.includes("/")) continue

    // Skip known stdlib packages
    const firstSegment = importPath.split("/")[0]!
    if (GO_STDLIB_PREFIXES.has(firstSegment)) continue

    // Create an import edge using the import path suffix as target.
    // For `github.com/org/repo/internal/utils`, the meaningful part
    // for in-repo resolution is the suffix after the module root.
    const segments = importPath.split("/")
    // e.g., "github.com/org/repo/pkg/utils" → "pkg/utils"
    const internalPath = segments.length > 3
      ? segments.slice(3).join("/")
      : segments[segments.length - 1]!

    const targetFileId = entityHash(repoId, internalPath, "file", internalPath)
    edges.push({
      from_id: fileId,
      to_id: targetFileId,
      kind: "imports",
      imported_symbols: [],
      import_type: "value",
      is_type_only: false,
    })

    // I-03: Also capture as external boundary (all non-stdlib Go imports with a domain)
    // Heuristic: imports with a domain (contains ".") like github.com/... are third-party
    if (firstSegment.includes(".")) {
      const { classifyBoundary } = require("@/lib/indexer/boundary-classifier") as typeof import("@/lib/indexer/boundary-classifier")
      edges.push({
        from_id: fileId,
        to_id: `external:${importPath}`,
        kind: "imports",
        imported_symbols: [],
        import_type: "value",
        is_type_only: false,
        is_external: true,
        package_name: importPath,
        boundary_category: classifyBoundary(importPath, "go"),
      })
    }
  }
}
