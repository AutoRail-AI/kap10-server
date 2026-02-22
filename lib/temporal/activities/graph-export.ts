/**
 * Phase 10a: Graph export activities for sync-local-graph workflow.
 *
 * Activities:
 *   - queryCompactGraph: Fetch all entities + edges from ArangoDB, compact for snapshot
 *   - serializeToMsgpack: Encode compact graph to msgpack buffer with checksum
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { compactEntity, compactEdge } from "@/lib/use-cases/graph-compactor"
import type { CompactEntity, CompactEdge } from "@/lib/use-cases/graph-compactor"
import { serializeSnapshot, computeChecksum } from "@/lib/use-cases/graph-serializer"

export interface GraphExportInput {
  orgId: string
  repoId: string
}

/**
 * Query all entities and edges from ArangoDB, compact them for snapshot.
 */
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

export async function queryCompactGraph(input: GraphExportInput): Promise<{
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

  for (const { path } of filePaths) {
    const fileEntities = await container.graphStore.getEntitiesByFile(orgId, repoId, path)
    for (const entity of fileEntities) {
      entities.push(compactEntity(entity))
    }
    heartbeat(`Compacted entities for ${entities.length} entities from ${filePaths.length} files`)
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

  // Fetch edges via callers/callees for each entity
  const edges: CompactEdge[] = []
  const edgeSet = new Set<string>()

  for (const entity of entities) {
    if (entity.kind === "file") continue
    try {
      const callees = await container.graphStore.getCalleesOf(orgId, entity.key)
      for (const callee of callees) {
        const edgeKey = `${entity.key}-calls-${callee.id}`
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey)
          edges.push(compactEdge({
            _from: entity.key,
            _to: callee.id,
            org_id: orgId,
            repo_id: repoId,
            kind: "calls",
          }))
        }
      }
    } catch {
      // Entity may not exist in graph
    }
    heartbeat(`Processing edges: ${edges.length} collected`)
  }

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
