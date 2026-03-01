/**
 * Phase 10a: Graph export activities for sync-local-graph workflow.
 *
 * Activities:
 *   - exportAndUploadGraph: Query graph, serialize to msgpack, upload to storage — all in one
 *     activity so the buffer never crosses Temporal's gRPC boundary (4MB limit).
 *   - queryCompactGraph: (deprecated) Fetch all entities + edges from ArangoDB
 *   - serializeToMsgpack: (deprecated) Encode compact graph to msgpack buffer
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { getPrisma } from "@/lib/db/prisma"
import { compactEdge, compactEntity } from "@/lib/use-cases/graph-compactor"
import type { CompactEdge, CompactEntity } from "@/lib/use-cases/graph-compactor"
import { computeChecksum, serializeSnapshot, serializeSnapshotChunked } from "@/lib/use-cases/graph-serializer"
import { logger } from "@/lib/utils/logger"

export interface GraphExportInput {
  orgId: string
  repoId: string
}

export interface CompactRule {
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
}

export interface CompactPattern {
  key: string
  name: string
  kind: string
  frequency: number
  confidence: number
  exemplar_keys: string[]
  promoted_rule_key: string
}

/**
 * Single activity: query graph → serialize to msgpack → upload to storage.
 * The buffer stays entirely inside the worker and NEVER crosses Temporal's
 * gRPC boundary (which has a 4MB limit). Only lightweight metadata is returned.
 */
export async function exportAndUploadGraph(input: GraphExportInput): Promise<{
  storagePath: string
  sizeBytes: number
  checksum: string
  entityCount: number
  edgeCount: number
}> {
  const log = logger.child({ service: "graph-export", organizationId: input.orgId, repoId: input.repoId })

  // Step 1: Query and compact graph data
  const { entities, edges, rules, patterns } = await queryCompactGraphInternal(input)
  log.info("Graph data compacted", { entityCount: entities.length, edgeCount: edges.length })

  // Step 2: Serialize to msgpack buffer (stays in worker memory)
  // K-14: Use chunked serialization for large datasets to limit peak memory
  const entityCount = entities.length
  const edgeCount = edges.length
  const CHUNK_THRESHOLD = 5000
  const buffer = entityCount > CHUNK_THRESHOLD
    ? serializeSnapshotChunked({
        repoId: input.repoId,
        orgId: input.orgId,
        entities,
        edges,
        rules,
        patterns,
        onChunkProgress: (processed, total) => {
          heartbeat(`Serializing entities: ${processed}/${total}`)
        },
      })
    : serializeSnapshot({
        repoId: input.repoId,
        orgId: input.orgId,
        entities,
        edges,
        rules,
        patterns,
      })
  const checksum = computeChecksum(buffer)
  heartbeat(`Serialized: ${buffer.length} bytes, ${entityCount} entities, ${edgeCount} edges`)

  // Free compacted data — only the buffer is needed now
  entities.length = 0
  edges.length = 0
  if (global.gc) global.gc()

  // Step 3: Upload buffer directly to Supabase Storage (never leaves the worker)
  const { supabase } = require("@/lib/db") as typeof import("@/lib/db")
  const bucketName = process.env.GRAPH_SNAPSHOT_BUCKET ?? "graph-snapshots"
  const storagePath = `${input.orgId}/${input.repoId}.msgpack`

  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, buffer, {
      contentType: "application/x-msgpack",
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`)
  }

  const sizeBytes = buffer.length
  heartbeat(`Uploaded ${sizeBytes} bytes to ${storagePath}`)

  // Step 4: Upsert snapshot metadata via Prisma
  const prisma = getPrisma()
  await prisma.graphSnapshotMeta.upsert({
    where: { repoId: input.repoId },
    create: {
      orgId: input.orgId,
      repoId: input.repoId,
      status: "available",
      checksum,
      storagePath,
      sizeBytes,
      entityCount,
      edgeCount,
      generatedAt: new Date(),
    },
    update: {
      status: "available",
      checksum,
      storagePath,
      sizeBytes,
      entityCount,
      edgeCount,
      generatedAt: new Date(),
    },
  })

  log.info("Graph snapshot exported and uploaded", { storagePath, sizeBytes, checksum: checksum.slice(0, 8) })
  return { storagePath, sizeBytes, checksum, entityCount, edgeCount }
}

/** @deprecated Use exportAndUploadGraph instead — buffer crosses gRPC boundary. */
export async function queryAndSerializeCompactGraph(input: GraphExportInput): Promise<{
  buffer: Buffer
  checksum: string
  entityCount: number
  edgeCount: number
}> {
  const { entities, edges, rules, patterns } = await queryCompactGraphInternal(input)
  const buffer = serializeSnapshot({
    repoId: input.repoId,
    orgId: input.orgId,
    entities,
    edges,
    rules,
    patterns,
  })
  const checksum = computeChecksum(buffer)
  heartbeat(`Serialized: ${buffer.length} bytes, ${entities.length} entities, ${edges.length} edges`)
  return { buffer, checksum, entityCount: entities.length, edgeCount: edges.length }
}

/** @deprecated Use queryAndSerializeCompactGraph instead. */
export async function queryCompactGraph(input: GraphExportInput): Promise<{
  entities: CompactEntity[]
  edges: CompactEdge[]
  rules: CompactRule[]
  patterns: CompactPattern[]
}> {
  return queryCompactGraphInternal(input)
}

async function queryCompactGraphInternal(input: GraphExportInput): Promise<{
  entities: CompactEntity[]
  edges: CompactEdge[]
  rules: CompactRule[]
  patterns: CompactPattern[]
}> {
  const container = getContainer()
  const { orgId, repoId } = input

  // Fetch all file paths, then entities per file
  const filePaths = await container.graphStore.getFilePaths(orgId, repoId)
  const entities: CompactEntity[] = []

  for (let fi = 0; fi < filePaths.length; fi++) {
    const fileEntities = await container.graphStore.getEntitiesByFile(orgId, repoId, filePaths[fi]!.path)
    for (const entity of fileEntities) {
      entities.push(compactEntity(entity))
    }
    // K-13: Granular heartbeats every 50 files
    if ((fi + 1) % 50 === 0 || fi === filePaths.length - 1) {
      heartbeat(`Collecting entities: ${fi + 1}/${filePaths.length} files, ${entities.length} entities`)
    }
  }

  // Also add file entities themselves
  for (const { path } of filePaths) {
    entities.push({
      key: path.replace(/[^a-zA-Z0-9]/g, "_"),
      kind: "file",
      name: path.split("/").pop() ?? path,
      file_path: path,
    })
  }

  // E-01: Batch edge fetching — single getAllEdges call instead of N getCalleesOf calls
  const edges: CompactEdge[] = []
  const edgeSet = new Set<string>()

  // Paginate getAllEdges for repos with many edges
  const PAGE_SIZE = 20000
  let allRawEdges: import("@/lib/ports/types").EdgeDoc[] = []
  let offset = 0
  let fetched: import("@/lib/ports/types").EdgeDoc[]
  do {
    fetched = await container.graphStore.getAllEdges(orgId, repoId, PAGE_SIZE)
    allRawEdges = allRawEdges.concat(fetched)
    offset += fetched.length
    heartbeat(`Fetching edges: ${allRawEdges.length} collected so far`)
  } while (fetched.length === PAGE_SIZE && offset < 200000) // safety cap

  // Build adjacency map from raw edges
  for (const rawEdge of allRawEdges) {
    const fromKey = rawEdge._from?.split("/").pop() ?? ""
    const toKey = rawEdge._to?.split("/").pop() ?? ""
    const edgeKey = `${fromKey}-${rawEdge.kind}-${toKey}`
    if (!edgeSet.has(edgeKey)) {
      edgeSet.add(edgeKey)
      edges.push(compactEdge({
        _from: fromKey,
        _to: toKey,
        org_id: orgId,
        repo_id: repoId,
        kind: rawEdge.kind,
      }))
    }
  }
  heartbeat(`Edge collection complete: ${edges.length} edges from ${allRawEdges.length} raw edges`)

  // Phase 10b: Export rules for this org+repo
  const rules: CompactRule[] = []
  try {
    const allRules = await container.graphStore.queryRules(orgId, {
      orgId,
      repoId,
      status: "active",
      limit: 200,
    })
    for (const rule of allRules) {
      rules.push({
        key: rule.id,
        name: rule.name || rule.title,
        scope: rule.scope,
        severity: rule.enforcement === "block" ? "error" : rule.enforcement === "warn" ? "warn" : "info",
        engine: rule.semgrepRule ? "semgrep" : rule.astGrepQuery ? "structural" : rule.type === "naming" ? "naming" : "structural",
        query: rule.astGrepQuery || rule.semgrepRule || "",
        message: rule.description,
        file_glob: rule.pathGlob || "",
        enabled: rule.status === "active",
        repo_id: rule.repo_id || repoId,
      })
    }
  } catch {
    // Rules not available — non-critical
  }

  // Phase 10b: Export patterns for this org+repo
  const patterns: CompactPattern[] = []
  try {
    const allPatterns = await container.graphStore.queryPatterns(orgId, {
      orgId,
      repoId,
      status: "confirmed",
      limit: 200,
    })
    for (const pattern of allPatterns) {
      patterns.push({
        key: pattern.id,
        name: pattern.name || pattern.title,
        kind: pattern.type,
        frequency: pattern.evidence?.length ?? 0,
        confidence: pattern.confidence,
        exemplar_keys: pattern.evidence?.slice(0, 5).map((e) => `${e.file}:${e.line}`) ?? [],
        promoted_rule_key: "",
      })
    }
  } catch {
    // Patterns not available — non-critical
  }

  heartbeat(`Compact graph complete: ${entities.length} entities, ${edges.length} edges, ${rules.length} rules, ${patterns.length} patterns`)
  return { entities, edges, rules, patterns }
}

/**
 * Serialize compact graph to msgpack buffer with checksum.
 */
export async function serializeToMsgpack(input: {
  repoId: string
  orgId: string
  entities: CompactEntity[]
  edges: CompactEdge[]
  rules?: CompactRule[]
  patterns?: CompactPattern[]
}): Promise<{
  buffer: Buffer
  checksum: string
  entityCount: number
  edgeCount: number
}> {
  const buffer = serializeSnapshot({
    repoId: input.repoId,
    orgId: input.orgId,
    entities: input.entities,
    edges: input.edges,
    rules: input.rules,
    patterns: input.patterns,
  })
  const checksum = computeChecksum(buffer)

  heartbeat(`Serialized: ${buffer.length} bytes, checksum ${checksum.slice(0, 8)}...`)

  return {
    buffer,
    checksum,
    entityCount: input.entities.length,
    edgeCount: input.edges.length,
  }
}
