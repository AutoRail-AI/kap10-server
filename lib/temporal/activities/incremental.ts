/**
 * Phase 5: Temporal activities for incremental indexing.
 * Split between heavy-compute-queue (CPU-bound) and light-llm-queue (network-bound).
 */

import { heartbeat } from "@temporalio/activity"
import { randomUUID } from "node:crypto"
import { getContainer } from "@/lib/di/container"
import { buildCascadeQueue } from "@/lib/indexer/cascade"
import { clearCallerCountCache } from "@/lib/indexer/centrality"
import { repairEdges } from "@/lib/indexer/edge-repair"
import { entityHash } from "@/lib/indexer/entity-hash"
import { withQuarantine, shouldHealQuarantine } from "@/lib/indexer/quarantine"
import { detectDeadCode } from "@/lib/justification/dead-code-detector"
import { buildGraphContexts } from "@/lib/justification/graph-context-builder"
import { computeHeuristicHint } from "@/lib/justification/model-router"
import { normalizeJustifications } from "@/lib/justification/post-processor"
import {
  buildJustificationPrompt,
  JUSTIFICATION_SYSTEM_PROMPT,
} from "@/lib/justification/prompt-builder"
import { scoreJustification } from "@/lib/justification/quality-scorer"
import { JustificationResultSchema } from "@/lib/justification/schemas"
import { computeBodyHash } from "@/lib/justification/staleness-checker"
import { buildTestContext } from "@/lib/justification/test-context-extractor"
import { LLM_MODELS } from "@/lib/llm/config"
import type { ChangedFile, EntityDiff, EntityDoc, IndexEventDoc, JustificationDoc } from "@/lib/ports/types"
import { buildEmbeddableDocuments } from "@/lib/temporal/activities/embedding"
import { writeEntitiesToGraph } from "@/lib/temporal/activities/graph-writer"

export interface PullAndDiffInput {
  orgId: string
  repoId: string
  workspacePath: string
  beforeSha: string
  afterSha: string
  branch: string
  installationId: number
}

export interface PullAndDiffResult {
  changedFiles: ChangedFile[]
  afterSha: string
}

/**
 * Pull latest changes and compute file diff.
 * Runs on heavy-compute-queue (uses git operations).
 */
export async function pullAndDiff(input: PullAndDiffInput): Promise<PullAndDiffResult> {
  const container = getContainer()
  heartbeat("pulling latest")

  await container.gitHost.pullLatest(input.workspacePath, input.branch)
  heartbeat("computing diff")

  const changedFiles = await container.gitHost.diffFiles(
    input.workspacePath,
    input.beforeSha,
    input.afterSha
  )

  return { changedFiles, afterSha: input.afterSha }
}

export interface ReIndexBatchInput {
  orgId: string
  repoId: string
  workspacePath: string
  filePaths: string[]
}

export interface ReIndexBatchResult {
  entityIds: string[]
  entityCount: number
  edgeCount: number
  quarantined: Array<{ filePath: string; reason: string }>
}

/**
 * Re-index a batch of changed files: extract entities/edges and write
 * directly to ArangoDB. Returns only entity IDs and counts — no large
 * payloads cross the Temporal boundary.
 */
export async function reIndexBatch(input: ReIndexBatchInput): Promise<ReIndexBatchResult> {
  const fs = require("node:fs") as typeof import("node:fs")
  const path = require("node:path") as typeof import("node:path")
  const { getPluginForExtension } = require("@/lib/indexer/languages/registry") as typeof import("@/lib/indexer/languages/registry")
  const { initializeRegistry } = require("@/lib/indexer/languages/registry") as typeof import("@/lib/indexer/languages/registry")
  await initializeRegistry()

  const allEntities: EntityDoc[] = []
  const allEdges: Array<{ _from: string; _to: string; kind: string; org_id: string; repo_id: string }> = []
  const allQuarantined: Array<{ filePath: string; reason: string }> = []

  for (const filePath of input.filePaths) {
    heartbeat(`indexing ${filePath}`)
    const fullPath = path.join(input.workspacePath, filePath)

    if (!fs.existsSync(fullPath)) continue

    const stats = fs.statSync(fullPath)
    const ext = path.extname(filePath)
    const result = await withQuarantine(
      filePath,
      stats.size,
      input.orgId,
      input.repoId,
      async () => {
        const entities: EntityDoc[] = []

        const fileId = entityHash(input.repoId, filePath, "file", filePath)
        entities.push({
          id: fileId,
          org_id: input.orgId,
          repo_id: input.repoId,
          kind: "file",
          name: filePath.split("/").pop() ?? filePath,
          file_path: filePath,
        })

        const plugin = getPluginForExtension(ext)
        if (plugin) {
          // K-07: Encoding-aware file reading
          const { readFileWithEncoding } = require("@/lib/indexer/file-reader") as typeof import("@/lib/indexer/file-reader")
          const fileResult = readFileWithEncoding(fullPath)
          if (!fileResult) return entities // Binary file — return file entity only
          const parsed = await plugin.parseWithTreeSitter({
            filePath,
            content: fileResult.content,
            orgId: input.orgId,
            repoId: input.repoId,
          })

          for (const pe of parsed.entities) {
            entities.push({
              id: pe.id,
              org_id: input.orgId,
              repo_id: input.repoId,
              kind: pe.kind,
              name: pe.name,
              file_path: pe.file_path,
              start_line: pe.start_line,
              end_line: pe.end_line,
              language: pe.language,
              signature: pe.signature,
              exported: pe.exported,
              doc: pe.doc,
              parent: pe.parent,
            })
          }

          for (const pe of parsed.edges) {
            allEdges.push({
              _from: pe.from_id,
              _to: pe.to_id,
              kind: pe.kind,
              org_id: input.orgId,
              repo_id: input.repoId,
            })
          }
          for (const pe of parsed.entities) {
            allEdges.push({
              _from: fileId,
              _to: pe.id,
              kind: "contains",
              org_id: input.orgId,
              repo_id: input.repoId,
            })
          }
        }

        return entities
      }
    )

    allEntities.push(...result.entities)
    allQuarantined.push(...result.quarantined)
  }

  // Write directly to ArangoDB — large payloads stay in the worker
  const container = getContainer()
  const writeResult = await writeEntitiesToGraph(
    container,
    input.orgId,
    input.repoId,
    allEntities,
    allEdges as import("@/lib/ports/types").EdgeDoc[],
  )

  // K-16: Heal quarantined entities — if a file that was previously quarantined
  // is now successfully parsed, delete its quarantine placeholder.
  if (allEntities.length > 0) {
    try {
      heartbeat("checking quarantine healing")
      // Fetch existing entities for the affected files to find quarantined ones
      const affectedFilePaths = Array.from(new Set(input.filePaths))
      const existingEntities: EntityDoc[] = []
      for (const fp of affectedFilePaths) {
        const fileEntities = await container.graphStore.getEntitiesByFile(
          input.orgId,
          input.repoId,
          fp,
        )
        existingEntities.push(...fileEntities)
      }

      const healedPaths = shouldHealQuarantine(existingEntities, allEntities)
      if (healedPaths.length > 0) {
        // Delete quarantine placeholder entities by their deterministic IDs
        const { createHash } = require("node:crypto") as typeof import("node:crypto")
        const quarantineKeys = healedPaths.map((fp) =>
          createHash("sha256")
            .update(`${input.repoId}\0${fp}\0quarantine`)
            .digest("hex")
            .slice(0, 16)
        )
        await container.graphStore.batchDeleteEntities(input.orgId, quarantineKeys)
        heartbeat(`healed ${healedPaths.length} quarantined files`)
      }
    } catch {
      // Quarantine healing is non-fatal — entities will be overwritten on next run
    }
  }

  return {
    entityIds: allEntities.map((e) => e.id),
    entityCount: writeResult.entitiesWritten,
    edgeCount: writeResult.edgesWritten,
    quarantined: allQuarantined,
  }
}

export interface ApplyEntityDiffsInput {
  orgId: string
  repoId: string
  addedEntityIds: string[]
  removedFilePaths: string[]
}

export interface ApplyEntityDiffsResult {
  entitiesAdded: number
  entitiesUpdated: number
  entitiesDeleted: number
}

/**
 * Finalize entity diffs: delete entities for removed files.
 * Added/updated entities are already written by reIndexBatch.
 * Only lightweight IDs/paths cross the Temporal boundary.
 */
export async function applyEntityDiffs(input: ApplyEntityDiffsInput): Promise<ApplyEntityDiffsResult> {
  const container = getContainer()
  heartbeat("applying entity diffs")

  let deletedCount = 0
  if (input.removedFilePaths.length > 0) {
    for (const filePath of input.removedFilePaths) {
      const fileEntities = await container.graphStore.getEntitiesByFile(
        input.orgId,
        input.repoId,
        filePath,
      )
      if (fileEntities.length > 0) {
        const keys = fileEntities.map((e) => e.id)
        await container.graphStore.batchDeleteEntities(input.orgId, keys)
        deletedCount += keys.length
      }
    }
  }

  return {
    entitiesAdded: input.addedEntityIds.length,
    entitiesUpdated: 0,
    entitiesDeleted: deletedCount,
  }
}

export interface RepairEdgesInput {
  orgId: string
  repoId: string
  changedEntityIds: string[]
  removedFilePaths: string[]
}

/**
 * Repair broken edges after entity changes.
 * Fetches full entity data from ArangoDB internally — only IDs cross Temporal.
 */
export async function repairEdgesActivity(input: RepairEdgesInput): Promise<{ edgesCreated: number; edgesDeleted: number }> {
  const container = getContainer()
  heartbeat("repairing edges")

  // Build a lightweight diff from IDs by fetching entities from ArangoDB
  const added: EntityDoc[] = []
  for (const id of input.changedEntityIds) {
    const entity = await container.graphStore.getEntity(input.orgId, id)
    if (entity) added.push(entity)
  }

  const deleted: EntityDoc[] = []
  for (const filePath of input.removedFilePaths) {
    const entities = await container.graphStore.getEntitiesByFile(input.orgId, input.repoId, filePath)
    deleted.push(...entities)
  }

  const diff: EntityDiff = { added, updated: [], deleted }
  return repairEdges(input.orgId, input.repoId, diff, container.graphStore)
}

export interface UpdateEmbeddingsInput {
  orgId: string
  repoId: string
  changedEntityKeys: string[]
}

/**
 * Update embeddings for changed entities.
 * Runs on light-llm-queue (network I/O).
 * Uses the same buildEmbeddableDocuments() as the full embedding pipeline
 * to ensure incremental and full-index embeddings are consistent.
 */
export async function updateEmbeddings(input: UpdateEmbeddingsInput): Promise<{ embeddingsUpdated: number }> {
  const container = getContainer()
  heartbeat("updating embeddings")

  if (input.changedEntityKeys.length === 0) return { embeddingsUpdated: 0 }

  // Fetch the changed entities
  const entities: EntityDoc[] = []
  for (const key of input.changedEntityKeys) {
    const entity = await container.graphStore.getEntity(input.orgId, key)
    if (entity) entities.push(entity)
  }

  if (entities.length === 0) return { embeddingsUpdated: 0 }

  // Load justification map for enriched embeddings (may be empty on first run)
  let justificationMap = new Map<string, JustificationDoc>()
  try {
    const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
    justificationMap = new Map(justifications.map((j) => [j.entity_id, j]))
  } catch {
    // Justifications may not exist yet — continue with empty map
  }

  // Reuse the same buildEmbeddableDocuments() as the full embedding pipeline
  const docs = buildEmbeddableDocuments(
    { orgId: input.orgId, repoId: input.repoId },
    entities,
    justificationMap,
  )

  if (docs.length === 0) return { embeddingsUpdated: 0 }

  const texts = docs.map((d) => d.text)
  const embeddings = await container.vectorSearch.embed(texts)

  await container.vectorSearch.upsert(
    docs.map((d) => d.entityKey),
    embeddings,
    docs.map((d) => d.metadata),
  )

  return { embeddingsUpdated: docs.length }
}

export interface CascadeReJustifyInput {
  orgId: string
  repoId: string
  changedEntityKeys: string[]
}

export interface CascadeReJustifyResult {
  cascadeStatus: "none" | "complete" | "skipped"
  cascadeEntities: number
}

/**
 * Cascade re-justification for changed entities and their callers.
 * Runs on light-llm-queue (LLM calls).
 */
export async function cascadeReJustify(input: CascadeReJustifyInput): Promise<CascadeReJustifyResult> {
  const container = getContainer()
  heartbeat("building cascade queue")

  if (input.changedEntityKeys.length === 0) {
    return { cascadeStatus: "none", cascadeEntities: 0 }
  }

  clearCallerCountCache()

  const cascadeResult = await buildCascadeQueue(
    input.changedEntityKeys,
    container.graphStore,
    container.vectorSearch
  )

  const allKeys = [...cascadeResult.reJustifyQueue, ...cascadeResult.cascadeQueue]
  if (allKeys.length === 0) {
    return { cascadeStatus: "skipped", cascadeEntities: 0 }
  }

  heartbeat(`re-justifying ${allKeys.length} entities via targeted subgraph`)

  // K-15: Fetch only the affected subgraph instead of the entire repo.
  // For each entity in the cascade queue, we need its 1-hop neighbors for context.
  const subgraphs = await container.graphStore.getBatchSubgraphs(input.orgId, allKeys, 1)
  heartbeat("loaded subgraphs for cascade entities")

  // Collect all entity IDs in the affected subgraph (cascade keys + their neighbors)
  const affectedKeySet = new Set(allKeys)
  const subgraphEntries = Array.from(subgraphs.entries())
  for (const [, sg] of subgraphEntries) {
    for (const e of sg.entities) affectedKeySet.add(e.id)
  }
  const affectedKeys = Array.from(affectedKeySet)

  // Fetch only the affected entities, edges, and justifications
  const affectedEntities: EntityDoc[] = []
  for (const [, sg] of subgraphEntries) {
    for (const e of sg.entities) affectedEntities.push(e)
  }
  // Deduplicate by ID
  const entityMap = new Map(affectedEntities.map((e) => [e.id, e]))
  const allEntities = Array.from(entityMap.values())

  const edges = await container.graphStore.getEdgesForEntities(input.orgId, affectedKeys)
  const ontology = await container.graphStore.getDomainOntology(input.orgId, input.repoId)

  // Fetch justifications only for affected entities
  const prevJustMap = new Map<string, JustificationDoc>()
  for (const key of affectedKeys) {
    const j = await container.graphStore.getJustification(input.orgId, key)
    if (j) prevJustMap.set(j.entity_id, j)
  }
  heartbeat("loaded justifications for affected entities")

  // Build name map
  const entityNameMap = new Map<string, string>()
  for (const e of allEntities) {
    entityNameMap.set(e.id, e.file_path ? `${e.name} in ${e.file_path}` : e.name)
  }

  // Build parent/sibling context
  const byParent = new Map<string, EntityDoc[]>()
  for (const e of allEntities) {
    const parent = e.parent as string | undefined
    if (parent) {
      const existing = byParent.get(parent)
      if (existing) existing.push(e)
      else byParent.set(parent, [e])
    }
  }

  // Dead code detection on the affected subgraph
  const deadCodeIds = detectDeadCode(allEntities, edges)

  // Filter to entities in the cascade queue
  const cascadeEntities = allKeys
    .map((key) => entityMap.get(key))
    .filter((e): e is EntityDoc => e != null)

  // Build graph contexts
  const graphContexts = await buildGraphContexts(cascadeEntities, container.graphStore, input.orgId)

  const results: JustificationDoc[] = []
  const defaultModel = LLM_MODELS.standard

  for (let i = 0; i < cascadeEntities.length; i++) {
    const entity = cascadeEntities[i]!
    heartbeat(`cascade justifying ${i + 1}/${cascadeEntities.length}: ${entity.name}`)

    try {
      const graphContext = graphContexts.get(entity.id) ?? { entityId: entity.id, neighbors: [] }

      // Compute heuristic hint (context for LLM, not a skip)
      const heuristicHint = computeHeuristicHint(entity)
      const isDeadCode = deadCodeIds.has(entity.id)

      // Build test context
      const testContext = buildTestContext(entity.id, allEntities, edges)

      // Parent justification
      const parentName = entity.parent as string | undefined
      let parentJustification: JustificationDoc | undefined
      let siblingNames: string[] | undefined
      if (parentName) {
        const parentEntity = allEntities.find(
          (e) => e.name === parentName && (e.kind === "class" || e.kind === "struct" || e.kind === "interface")
        )
        if (parentEntity) parentJustification = prevJustMap.get(parentEntity.id)
        const siblings = byParent.get(parentName)
        if (siblings && siblings.length > 1) {
          siblingNames = siblings.filter((s) => s.id !== entity.id).map((s) => s.name)
        }
      }

      // Gather dependency justifications
      const calleeJustifications: JustificationDoc[] = []
      const callerJustifications: JustificationDoc[] = []
      for (const neighbor of graphContext.neighbors) {
        const j = prevJustMap.get(neighbor.id)
        if (j) {
          if (neighbor.direction === "outbound") calleeJustifications.push(j)
          else callerJustifications.push(j)
        }
      }

      // Build full prompt
      const prompt = buildJustificationPrompt(
        entity,
        graphContext,
        ontology,
        calleeJustifications,
        testContext,
        {
          entityNameMap,
          parentJustification,
          siblingNames,
          callerJustifications,
          heuristicHint: heuristicHint ? { taxonomy: heuristicHint.taxonomy, featureTag: heuristicHint.featureTag, reason: heuristicHint.reason } : undefined,
          isDeadCode,
        }
      )

      const llmResult = await container.llmProvider.generateObject({
        model: defaultModel,
        schema: JustificationResultSchema,
        prompt,
        system: JUSTIFICATION_SYSTEM_PROMPT,
        temperature: 0.1,
      })

      const now = new Date().toISOString()
      const justification: JustificationDoc = {
        id: randomUUID(),
        org_id: input.orgId,
        repo_id: input.repoId,
        entity_id: entity.id,
        taxonomy: llmResult.object.taxonomy,
        confidence: llmResult.object.confidence,
        business_purpose: llmResult.object.businessPurpose,
        domain_concepts: llmResult.object.domainConcepts,
        feature_tag: llmResult.object.featureTag,
        semantic_triples: llmResult.object.semanticTriples,
        compliance_tags: llmResult.object.complianceTags ?? [],
        architectural_pattern: llmResult.object.architecturalPattern,
        model_tier: "standard",
        model_used: defaultModel,
        valid_from: now,
        valid_to: null,
        created_at: now,
      }
      ;(justification as Record<string, unknown>).reasoning = llmResult.object.reasoning

      // Attach body_hash for staleness detection
      ;(justification as Record<string, unknown>).body_hash = computeBodyHash(entity)

      // Score quality
      const quality = scoreJustification(justification)
      ;(justification as Record<string, unknown>).quality_score = quality.score
      if (quality.flags.length > 0) {
        ;(justification as Record<string, unknown>).quality_flags = quality.flags
      }

      results.push(justification)
      heartbeat(`justified ${entity.name}`)
    } catch (error: unknown) {
      // Log and continue — don't fail the whole cascade for one entity
      console.error(`Cascade re-justify failed for ${entity.name}:`, error instanceof Error ? error.message : String(error))
    }
  }

  // Store all results at once
  if (results.length > 0) {
    const normalized = normalizeJustifications(results)
    await container.graphStore.bulkUpsertJustifications(input.orgId, normalized)
  }

  // Re-embed justifications into dedicated justification_embeddings table
  if (container.vectorSearch.upsertJustificationEmbeddings) {
    try {
      heartbeat("re-embedding justifications")
      // K-15: Use already-loaded entity map and freshly stored results instead of re-fetching all
      const toEmbed = results

      if (toEmbed.length > 0) {
        const texts = toEmbed.map((j) => {
          const entity = entityMap.get(j.entity_id)
          const parts: string[] = []
          if (entity) {
            parts.push(`${entity.kind}: ${entity.name}`)
            parts.push(`File: ${entity.file_path}`)
            if (entity.doc) parts.push(`Documentation: ${String(entity.doc)}`)
          }
          parts.push(`Taxonomy: ${j.taxonomy}`)
          parts.push(`Purpose: ${j.business_purpose}`)
          if (j.domain_concepts.length > 0) parts.push(`Concepts: ${j.domain_concepts.join(", ")}`)
          parts.push(`Feature: ${j.feature_tag}`)
          if ((j as Record<string, unknown>).reasoning) parts.push(`Reasoning: ${String((j as Record<string, unknown>).reasoning)}`)
          if (j.compliance_tags.length > 0) parts.push(`Compliance: ${j.compliance_tags.join(", ")}`)
          if (j.semantic_triples.length > 0) {
            const tripleStr = j.semantic_triples.slice(0, 5).map((t) => `${t.subject} ${t.predicate} ${t.object}`).join("; ")
            parts.push(`Relations: ${tripleStr}`)
          }
          if (entity?.signature) parts.push(`Signature: ${String(entity.signature)}`)
          if (entity?.body) parts.push(String(entity.body).slice(0, 500))
          const text = parts.join("\n")
          return text.length > 1500 ? text.slice(0, 1500) : text
        })
        const embeddings = await container.vectorSearch.embed(texts)
        const metadata = toEmbed.map((j) => {
          const entity = entityMap.get(j.entity_id)
          return {
            orgId: j.org_id,
            repoId: j.repo_id,
            entityId: j.entity_id,
            entityName: entity?.name ?? j.feature_tag,
            taxonomy: j.taxonomy,
            featureTag: j.feature_tag,
            businessPurpose: j.business_purpose,
          }
        })
        await container.vectorSearch.upsertJustificationEmbeddings(embeddings, metadata)
        heartbeat(`re-embedded ${toEmbed.length} justifications`)
      }
    } catch (error: unknown) {
      // Non-fatal — embeddings can be rebuilt on next full justification run
      console.error("Cascade re-embed failed:", error instanceof Error ? error.message : String(error))
    }
  }

  return { cascadeStatus: "complete", cascadeEntities: allKeys.length }
}

export interface InvalidateCachesInput {
  orgId: string
  repoId: string
}

/**
 * Invalidate caches for the affected repo.
 * K-17: Exhaustive cache invalidation — covers all cache key patterns
 * that reference repo data: MCP tool caches, search caches, graph snapshots,
 * topological sort levels, justification levels, prefetch contexts, rules,
 * and graph-sync notifications.
 * Runs on light-llm-queue.
 */
export async function invalidateCaches(input: InvalidateCachesInput): Promise<void> {
  const container = getContainer()
  heartbeat("invalidating caches")

  // Exact-key invalidations — keys with known, fixed names per repo
  const exactKeys = [
    `mcp:stats:${input.orgId}:${input.repoId}`,
    `mcp:blueprint:${input.orgId}:${input.repoId}`,
    `mcp:health:${input.orgId}:${input.repoId}`,
    `mcp:features:${input.orgId}:${input.repoId}`,
    `graph:snapshot:${input.repoId}`,
    `graph-sync:${input.orgId}:${input.repoId}`,
    `topo:${input.orgId}:${input.repoId}:meta`,
  ]

  for (const key of exactKeys) {
    try {
      await container.cacheStore.invalidate(key)
    } catch {
      // Cache invalidation failure is non-fatal
    }
  }

  // Prefix-based invalidations — covers dynamic keys like
  // topo levels, justification levels, search results, prefetch contexts, rules
  if (container.cacheStore.invalidateByPrefix) {
    const prefixes = [
      `topo:${input.orgId}:${input.repoId}:level:`,
      `justify-changed:${input.orgId}:${input.repoId}:`,
      `search:${input.orgId}:${input.repoId}:`,
      `prefetch:ctx:${input.orgId}:${input.repoId}:`,
      `rules:resolved:${input.orgId}:${input.repoId}:`,
    ]

    for (const prefix of prefixes) {
      try {
        await container.cacheStore.invalidateByPrefix(prefix)
      } catch {
        // Non-fatal
      }
    }
  }
}

export interface WriteIndexEventInput {
  orgId: string
  repoId: string
  event: IndexEventDoc
}

/**
 * Write an index event to the graph store.
 * Runs on light-llm-queue.
 */
export async function writeIndexEvent(input: WriteIndexEventInput): Promise<void> {
  const container = getContainer()
  heartbeat("writing index event")
  await container.graphStore.insertIndexEvent(input.orgId, input.event)
}
