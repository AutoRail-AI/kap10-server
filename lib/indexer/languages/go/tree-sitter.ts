/**
 * Regex-based parser for Go source files.
 *
 * Extracts functions, structs, interfaces, and methods from Go files.
 */
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
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

  return { entities, edges }
}
