/**
 * Regex-based parser for Rust source files.
 *
 * Extracts functions, structs, enums, traits, impls, and type aliases.
 */
import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import { MAX_BODY_LINES } from "../../types"
import type { TreeSitterOptions } from "../types"

export interface RustParseResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
}

export function parseRustFile(opts: TreeSitterOptions): RustParseResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const lines = opts.content.split("\n")

  const fileId = entityHash(opts.repoId, opts.filePath, "file", opts.filePath)
  detectRustUseEdges(lines, fileId, opts.repoId, edges)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNum = i + 1
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue
    if (trimmed.startsWith("#[") || trimmed.startsWith("#![")) continue // attributes

    // Trait: [pub] trait Name [: SuperTrait] {
    const traitMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([\w\s+<>]+))?\s*\{?/)
    if (traitMatch) {
      const name = traitMatch[1]!
      const entity: ParsedEntity = {
        id: entityHash(opts.repoId, opts.filePath, "interface", name),
        kind: "interface",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "rust",
        exported: trimmed.startsWith("pub"),
      }
      entities.push(entity)
      continue
    }

    // Struct: [pub] struct Name {
    const structMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)(?:<[^>]*>)?/)
    if (structMatch) {
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "struct", structMatch[1]!),
        kind: "struct",
        name: structMatch[1]!,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "rust",
        exported: trimmed.startsWith("pub"),
      })
      continue
    }

    // Enum: [pub] enum Name {
    const enumMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)(?:<[^>]*>)?/)
    if (enumMatch) {
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "enum", enumMatch[1]!),
        kind: "enum",
        name: enumMatch[1]!,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "rust",
        exported: trimmed.startsWith("pub"),
      })
      continue
    }

    // Impl block: impl [Trait for] Type {
    const implMatch = trimmed.match(/^impl(?:<[^>]*>)?\s+(?:(\w+)\s+for\s+)?(\w+)(?:<[^>]*>)?\s*\{?/)
    if (implMatch) {
      const traitName = implMatch[1]
      const typeName = implMatch[2]!

      if (traitName) {
        // impl Trait for Type — creates an implements edge
        const typeId = entityHash(opts.repoId, opts.filePath, "struct", typeName)
        const traitId = entityHash(opts.repoId, opts.filePath, "interface", traitName)
        edges.push({ from_id: typeId, to_id: traitId, kind: "implements" })
      }
      // Don't create an entity for impl blocks themselves — they're structural containers
      continue
    }

    // Type alias: type Name = ...;
    const typeMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=/)
    if (typeMatch) {
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "type", typeMatch[1]!),
        kind: "type",
        name: typeMatch[1]!,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "rust",
        exported: trimmed.startsWith("pub"),
      })
      continue
    }

    // Module: [pub] mod name {
    const modMatch = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)/)
    if (modMatch) {
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "namespace", modMatch[1]!),
        kind: "namespace",
        name: modMatch[1]!,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "rust",
        exported: trimmed.startsWith("pub"),
      })
      continue
    }

    // Function: [pub] [async] fn name(params) [-> ReturnType] {
    const funcMatch = trimmed.match(
      /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*(.+?))?\s*(?:where\s+.+)?\s*\{?\s*$/
    )
    if (funcMatch) {
      const name = funcMatch[1]!
      const params = funcMatch[2] ?? ""
      const returnType = funcMatch[3]?.trim()
      const isAsync = trimmed.includes("async ")

      const sig = `fn ${name}(${params})${returnType ? ` -> ${returnType}` : ""}`
      entities.push({
        id: entityHash(opts.repoId, opts.filePath, "function", name, sig),
        kind: "function",
        name,
        file_path: opts.filePath,
        start_line: lineNum,
        language: "rust",
        signature: sig,
        exported: trimmed.startsWith("pub"),
        is_async: isAsync || undefined,
        parameter_count: countRustParams(params),
        return_type: returnType,
      })
    }
  }

  fillBraceMatchedBodies(entities, lines)
  detectCallEdges(entities, edges)

  return { entities, edges }
}

function countRustParams(params: string): number {
  if (!params.trim()) return 0
  // Exclude &self, &mut self, self
  const filtered = params.split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.match(/^&?\s*(?:mut\s+)?self$/))
  return filtered.length
}

function fillBraceMatchedBodies(entities: ParsedEntity[], lines: string[]): void {
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

    // Extract Rust doc comments (/// lines)
    if (!entity.doc) entity.doc = extractRustDocComment(lines, startIdx)

    const bodyLines = lines.slice(startIdx, Math.min(endIdx + 1, startIdx + MAX_BODY_LINES))
    if (bodyLines.length > 0) {
      entity.body = bodyLines.join("\n")
      if (entity.kind === "function") {
        entity.complexity = estimateRustComplexity(entity.body)
      }
    }
  }
}

function extractRustDocComment(lines: string[], entityLineIdx: number): string | undefined {
  if (entityLineIdx <= 0) return undefined
  let i = entityLineIdx - 1

  // Skip attributes (#[...])
  while (i >= 0 && lines[i]!.trim().startsWith("#[")) i--
  // Skip blank lines
  while (i >= 0 && !lines[i]!.trim()) i--
  if (i < 0) return undefined

  const currentLine = lines[i]!.trim()
  if (!currentLine.startsWith("///") && !currentLine.startsWith("//!")) return undefined

  const endIdx = i
  while (i > 0 && (lines[i - 1]!.trim().startsWith("///") || lines[i - 1]!.trim().startsWith("//!"))) i--

  const cleaned = lines.slice(i, endIdx + 1)
    .map((l) => l.trim().replace(/^\/\/\/\s?/, "").replace(/^\/\/!\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim()

  return cleaned.length >= 10 ? cleaned : undefined
}

function estimateRustComplexity(body: string): number {
  let complexity = 1
  const pattern = /\b(if|else\s+if|for|while|loop|match|Ok\(|Err\()\b|&&|\|\||\?/g
  let _match: RegExpExecArray | null
  while ((_match = pattern.exec(body)) !== null) complexity++
  return complexity
}

function detectCallEdges(entities: ParsedEntity[], edges: ParsedEdge[]): void {
  const callableMap = new Map<string, string>()
  for (const e of entities) {
    if (e.kind === "function") callableMap.set(e.name, e.id)
  }
  if (callableMap.size === 0) return

  const names = Array.from(callableMap.keys()).filter((n) => n.length > 1)
  if (names.length === 0) return

  const escapedNames = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const callPattern = new RegExp(`\\b(${escapedNames.join("|")})\\s*\\(`, "g")

  const edgeSet = new Set<string>()
  for (const entity of entities) {
    if (entity.kind !== "function") continue
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

function detectRustUseEdges(
  lines: string[],
  fileId: string,
  repoId: string,
  edges: ParsedEdge[],
): void {
  for (const line of lines) {
    const trimmed = line.trim()
    // use crate::module::Type;
    const useMatch = trimmed.match(/^(?:pub\s+)?use\s+(?:crate::)([\w:]+)/)
    if (useMatch) {
      const modPath = useMatch[1]!.replace(/::/g, "/")
      const targetFileId = entityHash(repoId, modPath, "file", modPath)
      edges.push({
        from_id: fileId,
        to_id: targetFileId,
        kind: "imports",
        imported_symbols: [],
        import_type: "value",
        is_type_only: false,
      })
    }
    // use super::sibling_mod;
    // External crates (use external_crate::...) — skip for now
  }
}
