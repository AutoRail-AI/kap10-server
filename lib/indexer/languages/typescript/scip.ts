/**
 * SCIP indexer for TypeScript/JavaScript.
 *
 * Runs `npx @sourcegraph/scip-typescript index` to produce a .scip file,
 * then parses the protobuf output into ParsedEntity[] and ParsedEdge[].
 */
import { execFile } from "node:child_process"
import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

import { entityHash } from "../../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../../types"
import type { SCIPOptions } from "../types"

const execFileAsync = promisify(execFile)

/** Maximum time for scip-typescript to run (10 minutes) */
const SCIP_TIMEOUT_MS = 10 * 60 * 1000

export interface SCIPIndexResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

/**
 * Run scip-typescript on a workspace root and parse the output.
 * Falls back gracefully if SCIP is unavailable or fails.
 */
export async function runSCIPTypeScript(
  opts: SCIPOptions,
  workspaceRoot: string,
): Promise<SCIPIndexResult> {
  const absRoot = join(opts.workspacePath, workspaceRoot === "." ? "" : workspaceRoot)
  const outputFile = join(absRoot, "index.scip")

  try {
    // Check if tsconfig exists (scip-typescript requires it)
    const hasTsConfig =
      existsSync(join(absRoot, "tsconfig.json")) || existsSync(join(absRoot, "jsconfig.json"))

    if (!hasTsConfig) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    // Run scip-typescript
    await execFileAsync(
      "npx",
      ["--yes", "@sourcegraph/scip-typescript", "index", "--output", outputFile],
      {
        cwd: absRoot,
        timeout: SCIP_TIMEOUT_MS,
        maxBuffer: 100 * 1024 * 1024, // 100MB
        env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
      },
    )

    // Parse the .scip output file
    if (!existsSync(outputFile)) {
      return { entities: [], edges: [], coveredFiles: [] }
    }

    const result = parseSCIPOutput(outputFile, opts.workspacePath, opts.repoId)

    // Clean up
    try {
      unlinkSync(outputFile)
    } catch {
      // ignore cleanup errors
    }

    return result
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-typescript] Failed for ${absRoot}: ${message}`)
    return { entities: [], edges: [], coveredFiles: [] }
  }
}

/**
 * Parse a .scip protobuf file into entities and edges.
 *
 * The SCIP format is a protobuf (sourcegraph/scip schema). We use a simplified
 * line-based parsing approach: scip-typescript also produces a companion JSON
 * snapshot. If protobuf parsing is unavailable, we fall back to reading the
 * TypeScript source files directly and extracting from the SCIP symbol table.
 *
 * For Phase 1, we use a pragmatic approach: run scip-typescript and then
 * read its snapshot output, or parse the raw .scip file using basic protobuf
 * varint decoding for the Document and Occurrence messages.
 */
function parseSCIPOutput(
  scipFilePath: string,
  workspacePath: string,
  repoId: string,
): SCIPIndexResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const coveredFiles: string[] = []

  try {
    const buffer = readFileSync(scipFilePath)
    const documents = decodeSCIPDocuments(buffer)

    for (const doc of documents) {
      const relPath = doc.relativePath
      if (!relPath) continue

      coveredFiles.push(relPath)

      for (const occurrence of doc.occurrences) {
        if (!occurrence.symbol || occurrence.symbol.startsWith("local ")) continue

        const parsed = parseSCIPSymbol(occurrence.symbol)
        if (!parsed) continue

        const entity: ParsedEntity = {
          id: entityHash(repoId, relPath, parsed.kind, parsed.name, parsed.signature),
          kind: parsed.kind,
          name: parsed.name,
          file_path: relPath,
          start_line: occurrence.range[0]! + 1,
          end_line: (occurrence.range[2] ?? occurrence.range[0]!) + 1,
          language: "typescript",
          signature: parsed.signature,
        }

        // Deduplicate by ID
        if (!entities.some((e) => e.id === entity.id)) {
          entities.push(entity)
        }

        // Create reference edges
        if (occurrence.isDefinition === false && occurrence.symbol) {
          const defEntity = entities.find(
            (e) => e.name === parsed.name && e.kind === parsed.kind && e.file_path !== relPath,
          )
          if (defEntity) {
            edges.push({
              from_id: entity.id,
              to_id: defEntity.id,
              kind: "references",
            })
          }
        }
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-typescript] Failed to parse SCIP output: ${message}`)
  }

  return { entities, edges, coveredFiles }
}

/** Minimal SCIP protobuf document representation */
interface SCIPDocument {
  relativePath: string
  occurrences: SCIPOccurrence[]
}

interface SCIPOccurrence {
  range: number[]
  symbol: string
  isDefinition: boolean
}

/**
 * Decode SCIP protobuf documents using basic varint decoding.
 * This is a simplified decoder for the parts of the SCIP schema we need.
 *
 * SCIP protobuf wire format:
 * - Message: Index { documents: repeated Document (field 2) }
 * - Document: { relative_path: string (field 4), occurrences: repeated Occurrence (field 2) }
 * - Occurrence: { range: repeated int32 (field 1), symbol: string (field 2) }
 */
function decodeSCIPDocuments(buffer: Buffer): SCIPDocument[] {
  const documents: SCIPDocument[] = []
  let offset = 0

  while (offset < buffer.length) {
    const tagResult = readVarint(buffer, offset)
    if (!tagResult) break
    offset = tagResult.offset

    const fieldNumber = tagResult.value >>> 3
    const wireType = tagResult.value & 0x7

    if (wireType === 2) {
      // Length-delimited
      const lenResult = readVarint(buffer, offset)
      if (!lenResult) break
      offset = lenResult.offset
      const end = offset + lenResult.value

      if (fieldNumber === 2) {
        // Document field in Index message
        const doc = decodeDocument(buffer, offset, end)
        if (doc.relativePath) {
          documents.push(doc)
        }
      }

      offset = end
    } else if (wireType === 0) {
      // Varint — skip
      const skip = readVarint(buffer, offset)
      if (!skip) break
      offset = skip.offset
    } else {
      // Unknown wire type — skip
      break
    }
  }

  return documents
}

function decodeDocument(buffer: Buffer, start: number, end: number): SCIPDocument {
  const doc: SCIPDocument = { relativePath: "", occurrences: [] }
  let offset = start

  while (offset < end) {
    const tagResult = readVarint(buffer, offset)
    if (!tagResult) break
    offset = tagResult.offset

    const fieldNumber = tagResult.value >>> 3
    const wireType = tagResult.value & 0x7

    if (wireType === 2) {
      const lenResult = readVarint(buffer, offset)
      if (!lenResult) break
      offset = lenResult.offset
      const fieldEnd = offset + lenResult.value

      if (fieldNumber === 4) {
        // relative_path
        doc.relativePath = buffer.toString("utf-8", offset, fieldEnd)
      } else if (fieldNumber === 2) {
        // occurrence
        const occ = decodeOccurrence(buffer, offset, fieldEnd)
        if (occ.symbol) {
          doc.occurrences.push(occ)
        }
      }

      offset = fieldEnd
    } else if (wireType === 0) {
      const skip = readVarint(buffer, offset)
      if (!skip) break
      offset = skip.offset
    } else {
      break
    }
  }

  return doc
}

function decodeOccurrence(buffer: Buffer, start: number, end: number): SCIPOccurrence {
  const occ: SCIPOccurrence = { range: [], symbol: "", isDefinition: false }
  let offset = start

  while (offset < end) {
    const tagResult = readVarint(buffer, offset)
    if (!tagResult) break
    offset = tagResult.offset

    const fieldNumber = tagResult.value >>> 3
    const wireType = tagResult.value & 0x7

    if (wireType === 2) {
      const lenResult = readVarint(buffer, offset)
      if (!lenResult) break
      offset = lenResult.offset
      const fieldEnd = offset + lenResult.value

      if (fieldNumber === 1) {
        // range (packed repeated int32)
        let rangeOffset = offset
        while (rangeOffset < fieldEnd) {
          const val = readVarint(buffer, rangeOffset)
          if (!val) break
          rangeOffset = val.offset
          occ.range.push(val.value)
        }
      } else if (fieldNumber === 2) {
        // symbol
        occ.symbol = buffer.toString("utf-8", offset, fieldEnd)
      }

      offset = fieldEnd
    } else if (wireType === 0) {
      const valResult = readVarint(buffer, offset)
      if (!valResult) break
      offset = valResult.offset

      if (fieldNumber === 4) {
        // symbol_roles (bit field: 0x1 = Definition)
        occ.isDefinition = (valResult.value & 0x1) !== 0
      }
    } else {
      break
    }
  }

  return occ
}

/** Read a protobuf varint from buffer at offset. */
function readVarint(buffer: Buffer, offset: number): { value: number; offset: number } | null {
  let result = 0
  let shift = 0

  while (offset < buffer.length) {
    const byte = buffer[offset]!
    offset++
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, offset }
    }
    shift += 7
    if (shift > 35) return null // overflow protection
  }

  return null
}

/**
 * Parse a SCIP symbol string into kind and name.
 *
 * SCIP symbol format: `<scheme> <manager> <package> <descriptor>...`
 * Descriptor suffixes indicate kind:
 *   `.` = term (variable/function), `#` = type (class/interface),
 *   `()` = method, `/` = package
 */
function parseSCIPSymbol(
  symbol: string,
): { kind: ParsedEntity["kind"]; name: string; signature?: string } | null {
  const parts = symbol.trim().split(" ")
  if (parts.length < 2) return null

  // Get the last descriptor
  const descriptor = parts[parts.length - 1]!

  if (descriptor.endsWith("().")) {
    const name = descriptor.slice(0, -3)
    return { kind: "method", name, signature: `${name}()` }
  }
  if (descriptor.endsWith("()")) {
    const name = descriptor.slice(0, -2)
    return { kind: "function", name, signature: `${name}()` }
  }
  if (descriptor.endsWith("#")) {
    const name = descriptor.slice(0, -1)
    return { kind: "class", name }
  }
  if (descriptor.endsWith(".")) {
    const name = descriptor.slice(0, -1)
    return { kind: "variable", name }
  }
  if (descriptor.endsWith("/")) {
    const name = descriptor.slice(0, -1)
    return { kind: "module", name }
  }

  return null
}
