/**
 * Shared SCIP protobuf decoder.
 *
 * Parses .scip files (Sourcegraph Code Intelligence Protocol) produced by
 * any SCIP indexer (scip-typescript, scip-python, scip-go, etc.) into
 * ParsedEntity[] and ParsedEdge[].
 *
 * The SCIP wire format is identical across languages — only the symbol
 * descriptors differ. This module extracts the decoder logic so all
 * language plugins share a single implementation.
 */
import { readFileSync } from "node:fs"

import { entityHash } from "./entity-hash"
import type { ParsedEdge, ParsedEntity } from "./types"

export interface SCIPDecodeResult {
  entities: ParsedEntity[]
  edges: ParsedEdge[]
  coveredFiles: string[]
}

/**
 * Parse a .scip protobuf file into entities and edges.
 *
 * @param scipFilePath - Absolute path to the .scip file
 * @param repoId - Repository ID for deterministic entity hashing
 * @param language - Language identifier (e.g., "typescript", "python", "go")
 */
export function parseSCIPOutput(
  scipFilePath: string,
  repoId: string,
  language: string,
): SCIPDecodeResult {
  const entities: ParsedEntity[] = []
  const edges: ParsedEdge[] = []
  const coveredFiles: string[] = []
  const seenIds = new Set<string>()

  try {
    const buffer = readFileSync(scipFilePath)
    const documents = decodeSCIPDocuments(buffer)

    // Pass 1: Collect all definitions and build symbol→entity map
    const symbolToEntityId = new Map<string, string>()
    // L-18a: Per-file entity index for containment lookup in Pass 2
    const fileEntityIndex = new Map<string, Array<{ id: string; startLine: number; kind: string }>>()

    for (const doc of documents) {
      const relPath = doc.relativePath
      if (!relPath) continue

      coveredFiles.push(relPath)

      for (const occurrence of doc.occurrences) {
        if (!occurrence.symbol || occurrence.symbol.startsWith("local ")) continue

        const parsed = parseSCIPSymbol(occurrence.symbol)
        if (!parsed) continue

        const id = entityHash(repoId, relPath, parsed.kind, parsed.name, parsed.signature)

        // O(1) dedup via Set (fixes L-05)
        if (!seenIds.has(id)) {
          seenIds.add(id)
          const startLine = occurrence.range[0]! + 1
          entities.push({
            id,
            kind: parsed.kind,
            name: parsed.name,
            file_path: relPath,
            start_line: startLine,
            end_line: (occurrence.range[2] ?? occurrence.range[0]!) + 1,
            language,
            signature: parsed.signature,
          })

          // L-18a: Index entity by file for containment lookup
          let fileEntities = fileEntityIndex.get(relPath)
          if (!fileEntities) {
            fileEntities = []
            fileEntityIndex.set(relPath, fileEntities)
          }
          fileEntities.push({ id, startLine, kind: parsed.kind })
        }

        // Track symbol→entity mapping for reference resolution
        if (occurrence.isDefinition) {
          symbolToEntityId.set(occurrence.symbol, id)
        }
      }
    }

    // L-18a: Sort each file's entity list by startLine ascending for binary search
    for (const fileEntities of fileEntityIndex.values()) {
      fileEntities.sort((a, b) => a.startLine - b.startLine)
    }

    // Pass 2: Create reference/call edges using containment lookup
    const edgeDedup = new Set<string>()
    for (const doc of documents) {
      const relPath = doc.relativePath
      if (!relPath) continue

      for (const occurrence of doc.occurrences) {
        if (!occurrence.symbol || occurrence.symbol.startsWith("local ")) continue
        if (occurrence.isDefinition) continue

        const parsed = parseSCIPSymbol(occurrence.symbol)
        if (!parsed) continue

        const defEntityId = symbolToEntityId.get(occurrence.symbol)
        if (!defEntityId) continue

        // L-18a: Find the containing entity using binary search.
        // The entity with the largest startLine <= referenceLine is the caller.
        const referenceLine = occurrence.range[0]! + 1
        const fileEntities = fileEntityIndex.get(relPath)
        if (!fileEntities || fileEntities.length === 0) continue

        let containingEntity: { id: string; kind: string } | null = null
        let lo = 0
        let hi = fileEntities.length - 1
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1
          if (fileEntities[mid]!.startLine <= referenceLine) {
            containingEntity = fileEntities[mid]!
            lo = mid + 1
          } else {
            hi = mid - 1
          }
        }

        if (!containingEntity) continue
        const refId = containingEntity.id

        // Skip self-references
        if (refId === defEntityId) continue

        // Only create edges if both entities exist
        if (!seenIds.has(refId) || !seenIds.has(defEntityId)) continue

        // Deduplicate edges
        const edgeKey = `${refId}\0${defEntityId}`
        if (edgeDedup.has(edgeKey)) continue
        edgeDedup.add(edgeKey)

        // L-18a: Classify edge — function/method targets are calls, others are references
        const targetKind = parsed.kind
        const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"

        edges.push({
          from_id: refId,
          to_id: defEntityId,
          kind: edgeKind,
        })
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scip-${language}] Failed to parse SCIP output: ${message}`)
  }

  return { entities, edges, coveredFiles }
}

// ---------------------------------------------------------------------------
// Protobuf wire format decoder
// ---------------------------------------------------------------------------

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
 *
 * SCIP protobuf wire format:
 * - Message: Index { documents: repeated Document (field 2) }
 * - Document: { relative_path: string (field 4), occurrences: repeated Occurrence (field 2) }
 * - Occurrence: { range: repeated int32 (field 1), symbol: string (field 2), symbol_roles: int32 (field 4) }
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

      // K-04: Bounds check — ensure length-delimited field doesn't exceed buffer
      if (end > buffer.length || end < offset) {
        break
      }

      if (fieldNumber === 2) {
        // Document field in Index message — wrap per-document decode in try-catch
        // so one corrupted document doesn't abort all remaining documents
        try {
          const doc = decodeDocument(buffer, offset, end)
          if (doc.relativePath) {
            documents.push(doc)
          }
        } catch {
          // K-04: Skip corrupted document, continue with next
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

      // K-04: Bounds check
      if (fieldEnd > end || fieldEnd < offset) break

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

      // K-04: Bounds check
      if (fieldEnd > end || fieldEnd < offset) break

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

// ---------------------------------------------------------------------------
// SCIP symbol parser
// ---------------------------------------------------------------------------

/**
 * Parse a SCIP symbol string into kind and name.
 *
 * SCIP symbol format: `<scheme> <manager> <package> <descriptor>...`
 * Descriptor suffixes indicate kind (consistent across all SCIP indexers):
 *   `.` = term (variable/function), `#` = type (class/interface/struct),
 *   `()` = method, `/` = package/module
 */
export function parseSCIPSymbol(
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
