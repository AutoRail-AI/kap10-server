/**
 * Phase 10a: Graph Serializer — msgpack encode/decode for graph snapshots.
 *
 * Snapshot envelope format:
 *   { version: 1, repoId, orgId, entities, edges, generatedAt }
 *
 * Uses msgpackr for fast binary serialization (~3-5x smaller than JSON).
 */

import { createHash } from "crypto"
import type { CompactEntity, CompactEdge } from "./graph-compactor"

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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unpack } = require("msgpackr") as typeof import("msgpackr")
  const data = unpack(buf) as SnapshotEnvelope
  if (!data || (data.version !== 1 && data.version !== 2)) {
    throw new Error(`Unsupported snapshot version: ${data?.version}`)
  }
  return data
}

/**
 * Compute SHA-256 hex digest of a Buffer.
 */
export function computeChecksum(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}
