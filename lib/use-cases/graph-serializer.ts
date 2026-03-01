/**
 * Phase 10a: Graph Serializer — msgpack encode/decode for graph snapshots.
 *
 * Snapshot envelope format:
 *   { version: 1, repoId, orgId, entities, edges, generatedAt }
 *
 * Uses msgpackr for fast binary serialization (~3-5x smaller than JSON).
 */

import { createHash } from "crypto"
import type { CompactEdge, CompactEntity } from "./graph-compactor"

export interface SnapshotEnvelope {
  version: number
  repoId: string
  orgId: string
  entities: CompactEntity[]
  edges: CompactEdge[]
  rules?: Array<{
    key: string
    name: string
    scope: string
    severity: string
    engine: string
    query: string
    message: string
    file_glob: string
    enabled: boolean
    repo_id: string
  }>
  patterns?: Array<{
    key: string
    name: string
    kind: string
    frequency: number
    confidence: number
    exemplar_keys: string[]
    promoted_rule_key: string
  }>
  generatedAt: string
}

/**
 * Serialize snapshot data to msgpack Buffer.
 */
export function serializeSnapshot(data: {
  repoId: string
  orgId: string
  entities: CompactEntity[]
  edges: CompactEdge[]
  rules?: SnapshotEnvelope["rules"]
  patterns?: SnapshotEnvelope["patterns"]
}): Buffer {
   
  const { pack } = require("msgpackr") as typeof import("msgpackr")
  const hasRulesOrPatterns = (data.rules && data.rules.length > 0) || (data.patterns && data.patterns.length > 0)
  const envelope: SnapshotEnvelope = {
    version: hasRulesOrPatterns ? 2 : 1,
    repoId: data.repoId,
    orgId: data.orgId,
    entities: data.entities,
    edges: data.edges,
    ...(data.rules && data.rules.length > 0 ? { rules: data.rules } : {}),
    ...(data.patterns && data.patterns.length > 0 ? { patterns: data.patterns } : {}),
    generatedAt: new Date().toISOString(),
  }
  return pack(envelope) as Buffer
}

/**
 * Deserialize a msgpack Buffer back into a SnapshotEnvelope.
 * Validates version field.
 */
export function deserializeSnapshot(buf: Buffer): SnapshotEnvelope {
   
  const { unpack } = require("msgpackr") as typeof import("msgpackr")
  const data = unpack(buf) as SnapshotEnvelope
  if (!data || (data.version !== 1 && data.version !== 2)) {
    throw new Error(`Unsupported snapshot version: ${data?.version}`)
  }
  return data
}

/**
 * K-14: Chunked serialization — serialize entities in batches to limit peak memory.
 * Instead of building the full SnapshotEnvelope in memory, serializes entity chunks
 * and concatenates the result. Each chunk is freed after serialization.
 */
export function serializeSnapshotChunked(data: {
  repoId: string
  orgId: string
  entities: CompactEntity[]
  edges: CompactEdge[]
  rules?: SnapshotEnvelope["rules"]
  patterns?: SnapshotEnvelope["patterns"]
  onChunkProgress?: (processed: number, total: number) => void
}, chunkSize = 1000): Buffer {
  const { pack } = require("msgpackr") as typeof import("msgpackr")
  const hasRulesOrPatterns = (data.rules && data.rules.length > 0) || (data.patterns && data.patterns.length > 0)

  // Log memory usage before serialization
  if (typeof process !== "undefined" && process.memoryUsage) {
    const mem = process.memoryUsage()
    console.log(`[graph-serializer] Pre-serialize memory: heap ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB`)
  }

  const totalEntities = data.entities.length

  // For small datasets, use the standard approach (overhead of chunking not worth it)
  if (totalEntities <= chunkSize) {
    return serializeSnapshot(data)
  }

  // Chunked approach: serialize in batches, concat
  const buffers: Buffer[] = []
  let processed = 0

  while (data.entities.length > 0) {
    // Splice out a chunk (releases references from the original array)
    const chunk = data.entities.splice(0, chunkSize)
    processed += chunk.length

    // Build a partial envelope for this chunk
    const isLastChunk = data.entities.length === 0
    const partialEnvelope: SnapshotEnvelope = {
      version: hasRulesOrPatterns ? 2 : 1,
      repoId: data.repoId,
      orgId: data.orgId,
      entities: chunk,
      edges: isLastChunk ? data.edges : [], // Edges go in the last chunk
      ...(isLastChunk && data.rules && data.rules.length > 0 ? { rules: data.rules } : {}),
      ...(isLastChunk && data.patterns && data.patterns.length > 0 ? { patterns: data.patterns } : {}),
      generatedAt: isLastChunk ? new Date().toISOString() : "",
    }

    buffers.push(pack(partialEnvelope) as Buffer)

    // Report progress
    if (data.onChunkProgress) {
      data.onChunkProgress(processed, totalEntities)
    }

    // Help GC by clearing the chunk reference
    chunk.length = 0
  }

  const result = Buffer.concat(buffers)

  // Log memory usage after serialization
  if (typeof process !== "undefined" && process.memoryUsage) {
    const mem = process.memoryUsage()
    console.log(`[graph-serializer] Post-serialize memory: heap ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB, buffer: ${Math.round(result.length / 1024 / 1024)}MB`)
  }

  return result
}

/**
 * Compute SHA-256 hex digest of a Buffer.
 */
export function computeChecksum(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}
