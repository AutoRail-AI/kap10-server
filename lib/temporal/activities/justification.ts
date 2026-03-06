/**
 * Phase 4: Justification activities — the core pipeline activities
 * for classifying entities with business justifications.
 *
 * Activities are self-sufficient: they fetch data from ArangoDB directly
 * to avoid exceeding Temporal's 4MB gRPC payload limit.
 */

import { heartbeat } from "@temporalio/activity"
import { randomUUID } from "node:crypto"
import { getContainer } from "@/lib/di/container"
import { detectCommunities } from "@/lib/justification/community-detection"
import { computeCalibratedConfidence, isDescriptiveName } from "@/lib/justification/confidence"
import { detectDeadCode } from "@/lib/justification/dead-code-detector"
import { buildGraphContexts } from "@/lib/justification/graph-context-builder"
import { extractIntentSignals } from "@/lib/justification/intent-signals"
import type { IntentSignals } from "@/lib/justification/intent-signals"
import { computeHeuristicHint, routeModel } from "@/lib/justification/model-router"
import { clusterFeatureAreas, deduplicateFeatures, normalizeJustifications } from "@/lib/justification/post-processor"
import {
  buildBatchJustificationPrompt,
  buildJustificationPrompt,
  JUSTIFICATION_SYSTEM_PROMPT,
} from "@/lib/justification/prompt-builder"
import { scoreJustification } from "@/lib/justification/quality-scorer"
import { BatchJustificationItemSchema, BatchJustificationResultSchema } from "@/lib/justification/schemas"
import type { GraphContext } from "@/lib/justification/schemas"
import { checkStaleness, computeBodyHash } from "@/lib/justification/staleness-checker"
import { buildTestContext } from "@/lib/justification/test-context-extractor"
import { topologicalSortEntityIds } from "@/lib/justification/topological-sort"
import { getMaxParallelChunks } from "@/lib/llm/config"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"
import type { PipelineContext } from "@/lib/temporal/activities/pipeline-logs"
import { pipelineLogger } from "@/lib/temporal/activities/pipeline-logs"
import { logger } from "@/lib/utils/logger"

export interface JustificationInput extends PipelineContext {}

export async function setJustifyingStatus(input: JustificationInput): Promise<void> {
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  log.info("Setting repo status to justifying")
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "justifying",
  })
}

/**
 * Fetch entities and edges for validation/logging, but only return counts.
 * The actual data stays in ArangoDB — downstream activities fetch it themselves.
 */
export async function fetchEntitiesAndEdges(
  input: JustificationInput
): Promise<{ entityCount: number; edgeCount: number }> {
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  const container = getContainer()
  heartbeat("fetching entities and edges")
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)
  log.info("Fetched entities and edges for justification", { entityCount: entities.length, edgeCount: edges.length })
  return { entityCount: entities.length, edgeCount: edges.length }
}

/**
 * Pre-warm ontology cache. Return value intentionally void —
 * downstream activities fetch the ontology themselves from ArangoDB,
 * avoiding serialization of the full DomainOntologyDoc through Temporal.
 */
export async function loadOntology(
  input: JustificationInput
): Promise<void> {
  const container = getContainer()
  await container.graphStore.getDomainOntology(input.orgId, input.repoId)
}

/**
 * L-21: Detect communities via Louvain and write community_id + community_label
 * back onto entities in ArangoDB. Runs before justification so the data is
 * available when buildGraphContexts reads entity metadata.
 */
export async function detectCommunitiesActivity(
  input: JustificationInput
): Promise<{ communityCount: number }> {
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "justifying")
  const container = getContainer()
  const activityStart = Date.now()

  heartbeat("fetching entities and edges for community detection")
  const fetchStart = Date.now()
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)
  const fetchMs = Date.now() - fetchStart

  // Diagnostic: surface entities that would have caused the localeCompare crash
  const namelessEntities = entities.filter((e) => !e.name && e.kind !== "file" && e.kind !== "directory")
  if (namelessEntities.length > 0) {
    log.warn("Found entities without name field (should have been filtered by getAllEntities)", {
      count: namelessEntities.length,
      samples: namelessEntities.slice(0, 5).map((e) => ({ id: e.id, kind: e.kind, file_path: e.file_path })),
    })
  }
  log.info("Community detection input", {
    totalEntities: entities.length,
    totalEdges: edges.length,
    namelessCount: namelessEntities.length,
    kindBreakdown: entities.reduce((acc: Record<string, number>, e) => {
      const k = e.kind ?? "unknown"
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {}),
  })

  heartbeat(`running Louvain on ${entities.length} entities`)
  const louvainStart = Date.now()
  const result = detectCommunities(entities, edges)
  const louvainMs = Date.now() - louvainStart
  log.info("Community detection complete", {
    totalCommunities: result.totalCommunities,
    significantCommunities: result.communities.size,
    louvainMs,
  })

  // Write community_id and community_label back onto entities
  if (result.assignments.size > 0) {
    heartbeat(`writing community labels to ${result.assignments.size} entities`)
    // Build entity kind lookup for correct collection routing
    const entityKindMap = new Map(entities.map((e) => [e.id, e.kind]))
    const updates: Array<{ id: string; kind: string; community_id: number; community_label: string }> = []
    for (const [entityId, communityId] of result.assignments) {
      const kind = entityKindMap.get(entityId)
      if (!kind) continue // skip entities not found in graph
      const info = result.communities.get(communityId)
      updates.push({
        id: entityId,
        kind,
        community_id: communityId,
        community_label: info?.label ?? `Community ${communityId}`,
      })
    }

    // Batch upsert in chunks to avoid large payloads
    const CHUNK_SIZE = 500
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE)
      heartbeat(`writing community labels chunk ${Math.floor(i / CHUNK_SIZE) + 1}`)
      await container.graphStore.bulkUpsertEntities(
        input.orgId,
        chunk.map((u) => ({
          id: u.id,
          kind: u.kind,
          community_id: u.community_id,
          community_label: u.community_label,
        }) as unknown as import("@/lib/ports/types").EntityDoc)
      )
    }
  }

  const totalMs = Date.now() - activityStart
  log.info("Community labels stored", { assignments: result.assignments.size, timing: { fetchMs, louvainMs, totalMs } })
  plog.log("info", "Step 4b/10", `Community detection — ${result.communities.size} communities, ${result.assignments.size} assignments | Fetch: ${fetchMs}ms, Louvain: ${louvainMs}ms, Total: ${totalMs}ms`)

  return { communityCount: result.communities.size }
}

/**
 * Perform topological sort by fetching entities/edges from ArangoDB.
 * Stores the level data in Redis (data residency) and returns only the
 * level count through Temporal's gRPC boundary. This avoids sending the
 * full string[][] (potentially 5MB+ for large repos) through Temporal.
 *
 * Each level is stored under a separate Redis key with a 2-hour TTL.
 * The workflow calls fetchTopologicalLevel(levelIndex) to retrieve
 * one level at a time when needed.
 */
export async function performTopologicalSort(
  input: JustificationInput
): Promise<{ levelCount: number }> {
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "justifying")
  const activityStart = Date.now()
  heartbeat("performing topological sort")
  const container = getContainer()

  const fetchStart = Date.now()
  const allEntities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)
  const fetchMs = Date.now() - fetchStart

  // Filter out file/directory entities — they have no justifiable business purpose.
  const entities = allEntities.filter((e) => e.kind !== "file" && e.kind !== "directory")
  const skippedFileEntities = allEntities.length - entities.length

  // Entity kind distribution for observability
  const kindDist: Record<string, number> = {}
  for (const e of entities) { kindDist[e.kind] = (kindDist[e.kind] ?? 0) + 1 }

  log.info("Topological sort input", { totalEntities: allEntities.length, codeEntities: entities.length, skippedFileEntities, edges: edges.length, fetchMs, kindDist })
  plog.log("info", "Step 4/10", `Sorting ${entities.length} code entities (skipped ${skippedFileEntities} file/dir) with ${edges.length} edges (fetch: ${fetchMs}ms)`)

  const sortStart = Date.now()
  const levels = topologicalSortEntityIds(entities, edges)
  const sortMs = Date.now() - sortStart

  // Level size distribution for observability
  const levelSizes = levels.map((l) => l.length)
  const maxLevelSize = Math.max(...levelSizes, 0)
  const avgLevelSize = levels.length > 0 ? Math.round(entities.length / levels.length) : 0

  log.info("Topological sort complete", { levelCount: levels.length, sortMs, maxLevelSize, avgLevelSize })

  // Store each level in Redis — data residency pattern
  const TTL = 7200 // 2 hours
  const baseKey = `topo:${input.orgId}:${input.repoId}`
  const storeStart = Date.now()
  for (let i = 0; i < levels.length; i++) {
    heartbeat(`storing topo level ${i + 1}/${levels.length} in cache`)
    await container.cacheStore.set(`${baseKey}:level:${i}`, levels[i], TTL)
  }
  await container.cacheStore.set(`${baseKey}:meta`, { levelCount: levels.length }, TTL)
  const storeMs = Date.now() - storeStart

  const totalMs = Date.now() - activityStart
  log.info("Topological sort stored in Redis", { timing: { fetchMs, sortMs, storeMs, totalMs } })
  plog.log("info", "Step 4/10", `Topological sort: ${levels.length} levels (max: ${maxLevelSize}, avg: ${avgLevelSize}) | Fetch: ${fetchMs}ms, Sort: ${sortMs}ms, Store: ${storeMs}ms, Total: ${totalMs}ms`)

  return { levelCount: levels.length }
}

/**
 * Fetch a single topological level's entity IDs from Redis.
 * Returns only the IDs for the requested level — keeps payloads small.
 */
export async function fetchTopologicalLevel(
  input: JustificationInput,
  levelIndex: number
): Promise<string[]> {
  const container = getContainer()
  const baseKey = `topo:${input.orgId}:${input.repoId}`
  const level = await container.cacheStore.get<string[]>(`${baseKey}:level:${levelIndex}`)
  if (!level) {
    throw new Error(`Topological level ${levelIndex} not found in cache (key: ${baseKey}:level:${levelIndex}). Cache may have expired.`)
  }
  return level
}

/**
 * Store changed entity IDs from a justification level into Redis.
 * This avoids returning large changedEntityIds arrays through Temporal.
 */
export async function storeChangedEntityIds(
  input: JustificationInput,
  levelIndex: number,
  changedEntityIds: string[]
): Promise<void> {
  const container = getContainer()
  const key = `justify-changed:${input.orgId}:${input.repoId}:level:${levelIndex}`
  await container.cacheStore.set(key, changedEntityIds, 7200)
}

/**
 * Fetch changed entity IDs from the previous level (for cascading staleness).
 * Returns empty array if no previous level or cache expired.
 */
export async function fetchPreviousLevelChangedIds(
  input: JustificationInput,
  levelIndex: number
): Promise<string[]> {
  if (levelIndex <= 0) return []
  const container = getContainer()
  const key = `justify-changed:${input.orgId}:${input.repoId}:level:${levelIndex - 1}`
  return (await container.cacheStore.get<string[]>(key)) ?? []
}

/**
 * Clean up all topological sort and changed-entity Redis keys after workflow completes.
 */
export async function cleanupJustificationCache(
  input: JustificationInput,
  levelCount: number
): Promise<void> {
  const container = getContainer()
  const baseKey = `topo:${input.orgId}:${input.repoId}`
  for (let i = 0; i < levelCount; i++) {
    await container.cacheStore.invalidate(`${baseKey}:level:${i}`)
    await container.cacheStore.invalidate(`justify-changed:${input.orgId}:${input.repoId}:level:${i}`)
  }
  await container.cacheStore.invalidate(`${baseKey}:meta`)
}

/**
 * Find the direct callers (next topological level up) of a specific entity.
 * Used by single-entity re-justification — runs topological sort internally,
 * returns only the caller IDs (small payload, doesn't need Redis data residency).
 */
export async function findEntityCallerIds(
  input: JustificationInput,
  entityId: string
): Promise<string[]> {
  heartbeat("finding entity callers via topological sort")
  const container = getContainer()
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)
  const levels = topologicalSortEntityIds(entities, edges)

  const entityLevelIdx = levels.findIndex((level) => level.includes(entityId))
  if (entityLevelIdx >= 0 && entityLevelIdx < levels.length - 1) {
    return levels[entityLevelIdx + 1] ?? []
  }
  return []
}

/**
 * Build a lookup map from entity ID → human-readable name with file path.
 */
function buildEntityNameMap(entities: EntityDoc[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of entities) {
    const name = e.name
    const path = e.file_path
    map.set(e.id, path ? `${name} in ${path}` : name)
  }
  return map
}

/**
 * Build parent justification and sibling name maps for context propagation.
 */
function buildParentAndSiblingContext(
  entities: EntityDoc[],
  allEntities: EntityDoc[],
  prevJustMap: Map<string, JustificationDoc>
): {
  parentJustMap: Map<string, JustificationDoc>
  siblingMap: Map<string, string[]>
} {
  const parentJustMap = new Map<string, JustificationDoc>()
  const siblingMap = new Map<string, string[]>()

  // Group all entities by parent name for sibling lookup
  const byParent = new Map<string, EntityDoc[]>()
  for (const e of allEntities) {
    const parent = e.parent as string | undefined
    if (parent) {
      const existing = byParent.get(parent)
      if (existing) {
        existing.push(e)
      } else {
        byParent.set(parent, [e])
      }
    }
  }

  for (const entity of entities) {
    const parentName = entity.parent as string | undefined
    if (!parentName) continue

    // Find parent entity's justification
    const parentEntity = allEntities.find(
      (e) => e.name === parentName && (e.kind === "class" || e.kind === "struct" || e.kind === "interface")
    )
    if (parentEntity) {
      const parentJust = prevJustMap.get(parentEntity.id)
      if (parentJust) {
        parentJustMap.set(entity.id, parentJust)
      }
    }

    // Get sibling names (other entities with same parent, excluding self)
    const siblings = byParent.get(parentName)
    if (siblings && siblings.length > 1) {
      siblingMap.set(
        entity.id,
        siblings.filter((s) => s.id !== entity.id).map((s) => s.name)
      )
    }
  }

  return { parentJustMap, siblingMap }
}

/**
 * Returns the max parallel chunks for justification based on the current LLM provider.
 * Exposed as a Temporal activity because workflows can't import Node modules directly.
 */
export async function getJustificationConcurrency(): Promise<number> {
  return getMaxParallelChunks()
}

/**
 * Justify a batch of entities by their IDs.
 * Fetches all needed data (entities, edges, ontology, previous justifications)
 * from ArangoDB internally. Uses dynamic batching to minimize LLM calls.
 * Stores results directly before returning a count.
 *
 * Changed entity IDs are stored in Redis via storeChangedEntityIds (called by
 * the workflow) — only the count crosses Temporal's gRPC boundary.
 */
export async function justifyBatch(
  input: JustificationInput,
  entityIds: string[],
  calleeChangedIds: string[] = []
): Promise<{ justifiedCount: number; changedEntityIds: string[] }> {
  const container = getContainer()
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  const results: JustificationDoc[] = []
  const pipelineLog = pipelineLogger(input, "justifying")
  const batchStart = Date.now()

  // Fetch all data needed for this batch from ArangoDB (parallelized)
  heartbeat(`fetching data for ${entityIds.length} entities`)
  const fetchStart = Date.now()
  const [allEntities, edges, ontology, previousJustifications] = await Promise.all([
    container.graphStore.getAllEntities(input.orgId, input.repoId),
    container.graphStore.getAllEdges(input.orgId, input.repoId),
    container.graphStore.getDomainOntology(input.orgId, input.repoId),
    container.graphStore.getJustifications(input.orgId, input.repoId),
  ])

  const fetchMs = Date.now() - fetchStart
  log.info("justifyBatch data loaded", { batchSize: entityIds.length, allEntities: allEntities.length, edges: edges.length, prevJustifications: previousJustifications.length, fetchMs })

  // Fetch user-provided context documents for prompt anchoring (context seeding)
  let contextDocuments: string | undefined
  try {
    const repo = await container.relationalStore.getRepo(input.orgId, input.repoId)
    if (repo?.contextDocuments) {
      contextDocuments = repo.contextDocuments
    }
  } catch {
    // Best-effort — don't fail justification if context fetch fails
  }

  // Filter to just the entities in this batch, excluding file/directory entities
  const entityIdSet = new Set(entityIds)
  let entities = allEntities.filter((e) => entityIdSet.has(e.id) && e.kind !== "file" && e.kind !== "directory")

  // Build lookup maps early for staleness check
  const prevJustMap = new Map<string, JustificationDoc>()
  for (const j of previousJustifications) {
    prevJustMap.set(j.entity_id, j)
  }

  // Staleness detection: skip unchanged entities (L-09: change-type aware)
  const calleeChangedSet = new Set(calleeChangedIds)
  const { stale, fresh, staleReasons } = checkStaleness(entities, prevJustMap, calleeChangedSet, edges)
  if (fresh.length > 0) {
    heartbeat(`skipping ${fresh.length} fresh entities (unchanged since last justification)`)
  }
  // L-09: Log staleness classification reasons for observability
  if (staleReasons.size > 0) {
    const reasonCounts = new Map<string, number>()
    staleReasons.forEach((reason) => {
      // Extract reason category (before colon or full reason)
      const category = reason.includes(":") ? reason.split(":")[0]!.trim() : reason
      reasonCounts.set(category, (reasonCounts.get(category) ?? 0) + 1)
    })
    log.info("Staleness classification", {
      staleCount: stale.length,
      freshCount: fresh.length,
      reasonBreakdown: Object.fromEntries(Array.from(reasonCounts.entries())),
    })
  }
  entities = stale

  // Build graph contexts for this batch
  heartbeat(`building graph contexts for ${entities.length} entities`)
  const graphContexts = await buildGraphContexts(
    entities,
    container.graphStore,
    input.orgId
  )

  const entityNameMap = buildEntityNameMap(allEntities)
  const { parentJustMap, siblingMap } = buildParentAndSiblingContext(entities, allEntities, prevJustMap)

  const { getModelForGroup } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")
  const defaultModel = getModelForGroup("code_reasoning")

  // Dead code detection: auto-classify entities with zero inbound references (L-17: Map with reasons)
  const deadCodeMap = detectDeadCode(allEntities, edges)

  // I-02: Fetch git history per unique file path (grouped to avoid redundant git log calls)
  const fileHistoryMap = new Map<string, string[]>()
  const workspacePath = `/data/repo-indices/${input.orgId}/${input.repoId}`
  try {
    const filePathSet = new Set(entities.map((e) => e.file_path).filter(Boolean))
    const uniqueFilePaths = Array.from(filePathSet)
    heartbeat(`fetching git history for ${uniqueFilePaths.length} files`)
    // Fetch in parallel but limit concurrency to avoid spawning too many git processes
    const HISTORY_BATCH_SIZE = 10
    for (let hi = 0; hi < uniqueFilePaths.length; hi += HISTORY_BATCH_SIZE) {
      const batch = uniqueFilePaths.slice(hi, hi + HISTORY_BATCH_SIZE)
      const results = await Promise.all(
        batch.map(async (fp) => {
          const commits = await container.gitHost.getFileGitHistory(workspacePath, fp, 10)
          return { fp, commits }
        })
      )
      for (const { fp, commits } of results) {
        if (commits.length > 0) {
          fileHistoryMap.set(
            fp,
            commits.map((c) => {
              const body = c.body ? ` — ${c.body.slice(0, 120)}` : ""
              return `${c.sha.slice(0, 7)}: ${c.subject}${body}`
            })
          )
        }
      }
    }
  } catch {
    // Best-effort — don't fail justification if git history fetch fails
  }

  // C-05: Heuristic bypass — skip LLM for pure-utility entities with high confidence and 0 callers
  const HEURISTIC_BYPASS_CONFIDENCE = 0.9
  const bypassedResults: JustificationDoc[] = []

  // Most entities go to LLM — heuristic hints are passed as context
  const llmEntities: Array<{
    entity: EntityDoc
    graphContext: GraphContext
    testContext: import("@/lib/justification/types").TestContext | undefined
    depJustifications: JustificationDoc[]
    callerJustifications: JustificationDoc[]
    route: import("@/lib/justification/schemas").ModelRoute
    parentJustification?: JustificationDoc
    siblingNames?: string[]
    heuristicHint?: { taxonomy: string; featureTag: string; reason: string }
    isDeadCode?: boolean
    deadCodeReason?: string
    historicalContext?: string[]
    intentSignals?: IntentSignals
  }> = []

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!
    heartbeat(`processing entity ${i + 1}/${entities.length}: ${entity.name}`)

    const graphContext = graphContexts.get(entity.id)

    // Compute heuristic hint (passed as context to LLM, not used to skip)
    const heuristicHint = computeHeuristicHint(entity)
    const isDeadCode = deadCodeMap.has(entity.id)
    const deadCodeReason = deadCodeMap.get(entity.id)

    // Route model — all entities go to LLM
    // Count inbound callers for tier routing (high callers → premium)
    const callerCount = graphContext
      ? graphContext.neighbors.filter((n) => n.direction === "inbound").length
      : 0
    const route = routeModel(entity, {
      centrality: graphContext?.centrality,
      callerCount,
    })

    // Build test context
    const testContext = buildTestContext(entity.id, allEntities, edges)

    // L-20: Extract intent signals for prompt enrichment
    const intentSignals = extractIntentSignals(
      entity,
      testContext,
      fileHistoryMap.get(entity.file_path),
      graphContext?.neighbors ?? [],
      allEntities
    )

    // Gather dependency justifications (split by direction)
    const calleeJustifications: JustificationDoc[] = []
    const callerJustifications: JustificationDoc[] = []
    if (graphContext) {
      for (const neighbor of graphContext.neighbors) {
        const j = prevJustMap.get(neighbor.id)
        if (j) {
          if (neighbor.direction === "outbound") {
            calleeJustifications.push(j)
          } else {
            callerJustifications.push(j)
          }
        }
      }
    }

    // C-05: Heuristic bypass — skip LLM for pure-utility entities
    // Conditions: high confidence hint (≥0.9), 0 inbound callers, not safety-relevant
    if (
      heuristicHint &&
      heuristicHint.confidence >= HEURISTIC_BYPASS_CONFIDENCE &&
      callerCount === 0
    ) {
      const now = new Date().toISOString()
      bypassedResults.push({
        id: randomUUID(),
        org_id: input.orgId,
        repo_id: input.repoId,
        entity_id: entity.id,
        taxonomy: heuristicHint.taxonomy,
        confidence: heuristicHint.confidence,
        business_purpose: heuristicHint.businessPurpose,
        domain_concepts: [],
        feature_tag: heuristicHint.featureTag,
        semantic_triples: [],
        compliance_tags: [],
        model_tier: "heuristic" as JustificationDoc["model_tier"],
        model_used: "heuristic-bypass",
        valid_from: now,
        valid_to: null,
        created_at: now,
      })
      continue
    }

    llmEntities.push({
      entity,
      graphContext: graphContext ?? { entityId: entity.id, neighbors: [] },
      testContext,
      depJustifications: calleeJustifications,
      callerJustifications,
      route,
      parentJustification: parentJustMap.get(entity.id),
      siblingNames: siblingMap.get(entity.id),
      heuristicHint: heuristicHint ? { taxonomy: heuristicHint.taxonomy, featureTag: heuristicHint.featureTag, reason: heuristicHint.reason } : undefined,
      isDeadCode,
      deadCodeReason,
      historicalContext: fileHistoryMap.get(entity.file_path),
      intentSignals,
    })
  }

  log.info("justifyBatch entity preparation", {
    batchEntities: entities.length,
    heuristicBypassed: bypassedResults.length,
    llmEntities: llmEntities.length,
    deadCodeCount: Array.from(deadCodeMap.keys()).filter((id) => entityIdSet.has(id)).length,
  })

  // Group entities by model tier for batching (don't mix premium with fast)
  const byTier = new Map<string, typeof llmEntities>()
  for (const item of llmEntities) {
    const tier = item.route.tier
    const existing = byTier.get(tier)
    if (existing) {
      existing.push(item)
    } else {
      byTier.set(tier, [item])
    }
  }

  const now = new Date().toISOString()

  // Log tier distribution
  const tierDist: Record<string, number> = {}
  for (const [tier, items] of Array.from(byTier.entries())) { tierDist[tier] = items.length }
  log.info("justifyBatch tier distribution", { tierDist })

  for (const tier of Array.from(byTier.keys())) {
    const tierEntities = byTier.get(tier)!
    const modelToUse = tierEntities[0]?.route.model ?? defaultModel

    // Build O(1) lookup for tier entities by ID
    const tierEntityMap = new Map(tierEntities.map((te) => [te.entity.id, te]))
    const tierStart = Date.now()

    heartbeat(`processing tier ${tier} (${tierEntities.length} entities) via generateBatchObjects`)
    log.info(`LLM justification starting for tier`, { tier, entities: tierEntities.length, model: modelToUse })

    // Delegate all batching, retry, rate-limiting, and error recovery to the LLM port layer
    const { results: batchResults, failures } = await container.llmProvider.generateBatchObjects({
      model: modelToUse,
      items: tierEntities,
      buildPrompt: (items) => buildBatchJustificationPrompt(
        items.map((te) => ({
          entity: te.entity,
          graphContext: te.graphContext,
          parentJustification: te.parentJustification,
          calleeJustifications: te.depJustifications,
          heuristicHint: te.heuristicHint,
          isDeadCode: te.isDeadCode,
          deadCodeReason: te.deadCodeReason,
          intentSignals: te.intentSignals,
        })),
        ontology,
        entityNameMap
      ),
      buildSinglePrompt: (item) => buildJustificationPrompt(
        item.entity,
        item.graphContext,
        ontology,
        item.depJustifications,
        item.testContext,
        {
          entityNameMap,
          parentJustification: item.parentJustification,
          siblingNames: item.siblingNames,
          modelTier: tier === "premium" ? "premium" : tier === "fast" ? "fast" : "standard",
          callerJustifications: item.callerJustifications,
          heuristicHint: item.heuristicHint,
          isDeadCode: item.isDeadCode,
          deadCodeReason: item.deadCodeReason,
          contextDocuments,
          historicalContext: item.historicalContext,
          intentSignals: item.intentSignals,
        }
      ),
      schema: BatchJustificationItemSchema,
      batchSchema: BatchJustificationResultSchema,
      matchResult: (item, result) => result.entityId === item.entity.id,
      system: JUSTIFICATION_SYSTEM_PROMPT,
      temperature: 0.1,
      onProgress: (msg) => heartbeat(msg),
    })

    // Map successful results to JustificationDocs
    for (const [item, result] of batchResults) {
      const doc: JustificationDoc = {
        id: randomUUID(),
        org_id: input.orgId,
        repo_id: input.repoId,
        entity_id: item.entity.id,
        taxonomy: result.taxonomy,
        confidence: result.confidence,
        business_purpose: result.businessPurpose,
        domain_concepts: result.domainConcepts,
        feature_tag: result.featureTag,
        semantic_triples: result.semanticTriples,
        compliance_tags: result.complianceTags ?? [],
        architectural_pattern: result.architecturalPattern,
        model_tier: tier as JustificationDoc["model_tier"],
        model_used: modelToUse,
        valid_from: now,
        valid_to: null,
        created_at: now,
      }
      ;(doc as Record<string, unknown>).reasoning = result.reasoning
      results.push(doc)

      const purposeTruncated = doc.business_purpose.length > 100
        ? doc.business_purpose.slice(0, 100) + "…"
        : doc.business_purpose
      pipelineLog.log(
        "info",
        "Justification",
        `Analyzed ${item.entity.name}. Tagged as ${doc.taxonomy} (${Math.round(doc.confidence * 100)}%) — ${purposeTruncated}`
      )
    }

    // Failures → heuristic fallback or fallback justification
    for (const item of failures) {
      const hint = computeHeuristicHint(item.entity)
      if (hint && hint.confidence >= 0.85) {
        results.push({
          id: randomUUID(),
          org_id: input.orgId,
          repo_id: input.repoId,
          entity_id: item.entity.id,
          taxonomy: hint.taxonomy,
          confidence: hint.confidence,
          business_purpose: hint.businessPurpose,
          domain_concepts: [],
          feature_tag: hint.featureTag,
          semantic_triples: [],
          compliance_tags: [],
          model_tier: "heuristic" as JustificationDoc["model_tier"],
          model_used: "heuristic-fallback",
          valid_from: now,
          valid_to: null,
          created_at: now,
        })
        pipelineLog.log("info", "Justification", `Heuristic fallback for ${item.entity.name}: ${hint.taxonomy}`)
      } else {
        results.push(createFallbackJustification(input, item.entity.id, tier, modelToUse, "All retries exhausted", now))
        pipelineLog.log("warn", "Justification", `Fallback created for ${item.entity.name}: all retries exhausted`)
      }
    }

    const tierMs = Date.now() - tierStart
    if (failures.length > 0) {
      log.warn("Batch processing had failures", { tier, failures: failures.length, succeeded: batchResults.size, tierMs })
    } else {
      log.info(`LLM justification complete for tier`, { tier, succeeded: batchResults.size, tierMs })
    }
  }

  // Attach body_hash to each result for staleness detection on re-runs
  const entityMap = new Map(entities.map((e) => [e.id, e]))
  for (const r of results) {
    const entity = entityMap.get(r.entity_id)
    if (entity) {
      ;(r as Record<string, unknown>).body_hash = computeBodyHash(entity)
    }
  }

  if (global.gc) global.gc()

  // C-05: Merge heuristic-bypassed results with LLM results
  if (bypassedResults.length > 0) {
    pipelineLog.log("info", "Justification", `Heuristic bypass: ${bypassedResults.length} pure-utility entities skipped LLM`)
    results.push(...bypassedResults)
  }

  // L-19: Apply calibrated confidence to all results
  for (const r of results) {
    const entity = entityMap.get(r.entity_id)
    const gc = graphContexts.get(r.entity_id)
    const signals = {
      hasCallers: gc ? gc.neighbors.some((n) => n.direction === "inbound") : false,
      hasCallees: gc ? gc.neighbors.some((n) => n.direction === "outbound") : false,
      hasTests: !!(entity && buildTestContext(entity.id, allEntities, edges)?.assertions?.length),
      hasDocs: !!(entity?.doc),
      hasDescriptiveName: entity ? isDescriptiveName(entity.name) : false,
      llmConfidence: r.confidence,
      llmModelTier: (r.model_tier ?? "standard") as "heuristic" | "fast" | "standard" | "premium",
      pageRankPercentile: entity ? ((entity as Record<string, unknown>).pagerank_percentile as number | undefined) ?? 0 : 0,
    }
    const calibrated = computeCalibratedConfidence(signals)
    ;(r as Record<string, unknown>).calibrated_confidence = calibrated.composite
    ;(r as Record<string, unknown>).confidence_breakdown = calibrated.breakdown
  }

  // Store results directly (merged storeJustifications into justifyBatch)
  if (results.length > 0) {
    heartbeat(`storing ${results.length} justifications`)
    const normalized = normalizeJustifications(results)

    // Score quality of LLM-generated justifications (store as metadata)
    for (const j of normalized) {
      if (j.model_tier !== "heuristic") {
        const quality = scoreJustification(j)
        ;(j as Record<string, unknown>).quality_score = quality.score
        if (quality.flags.length > 0) {
          ;(j as Record<string, unknown>).quality_flags = quality.flags
        }
      }
    }

    await container.graphStore.bulkUpsertJustifications(input.orgId, normalized)
  }

  // Return IDs of entities that were re-justified (for cascading invalidation)
  const changedEntityIds = results.map((r) => r.entity_id)
  const totalBatchMs = Date.now() - batchStart

  // Quality score distribution for observability
  const qualityScores = results.map((r) => (r as Record<string, unknown>).quality_score as number | undefined).filter(Boolean) as number[]
  const avgQuality = qualityScores.length > 0 ? Math.round(qualityScores.reduce((a: number, b: number) => a + b, 0) / qualityScores.length * 100) / 100 : 0

  // Taxonomy distribution
  const taxDist: Record<string, number> = {}
  for (const r of results) { taxDist[r.taxonomy] = (taxDist[r.taxonomy] ?? 0) + 1 }

  log.info("justifyBatch complete", {
    inputSize: entityIds.length,
    justified: results.length,
    heuristicBypassed: bypassedResults.length,
    avgQuality,
    taxDist,
    totalBatchMs,
  })

  return { justifiedCount: results.length, changedEntityIds }
}


/** Create a fallback justification when LLM fails */
function createFallbackJustification(
  input: JustificationInput,
  entityId: string,
  tier: string,
  model: string | undefined,
  errorMessage: string,
  now: string
): JustificationDoc {
  const fallback: JustificationDoc = {
    id: randomUUID(),
    org_id: input.orgId,
    repo_id: input.repoId,
    entity_id: entityId,
    taxonomy: "UTILITY",
    confidence: 0.3,
    business_purpose: `Classification failed: ${errorMessage}`,
    domain_concepts: [],
    feature_tag: "unclassified",
    semantic_triples: [],
    compliance_tags: [],
    model_tier: tier as JustificationDoc["model_tier"],
    model_used: model,
    valid_from: now,
    valid_to: null,
    created_at: now,
  }
  ;(fallback as Record<string, unknown>).reasoning = `LLM call failed: ${errorMessage}`
  return fallback
}

/**
 * Run bi-directional context propagation across the entity hierarchy.
 * Enriches justifications with propagated feature tags and domain concepts
 * from parent/child relationships.
 */
export async function propagateContextActivity(
  input: JustificationInput
): Promise<void> {
  const { propagateContext } = require("@/lib/justification/context-propagator") as typeof import("@/lib/justification/context-propagator")
  const container = getContainer()
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "justifying")
  const activityStart = Date.now()
  heartbeat("propagating context across entity hierarchy")
  plog.log("info", "Step 6/10", "Fetching entities, edges, and justifications for context propagation...")

  const fetchStart = Date.now()
  const [allEntities, edges, justifications] = await Promise.all([
    container.graphStore.getAllEntities(input.orgId, input.repoId),
    container.graphStore.getAllEdges(input.orgId, input.repoId),
    container.graphStore.getJustifications(input.orgId, input.repoId),
  ])
  const fetchMs = Date.now() - fetchStart
  log.info("Context propagation data loaded", { entities: allEntities.length, edges: edges.length, justifications: justifications.length, fetchMs })

  if (justifications.length === 0) {
    plog.log("info", "Step 6/10", "No justifications to propagate — skipping")
    return
  }

  plog.log("info", "Step 6/10", `Propagating context across ${justifications.length} justifications...`)

  const justMap = new Map<string, JustificationDoc>()
  for (const j of justifications) {
    justMap.set(j.entity_id, j)
  }

  const propStart = Date.now()
  propagateContext(allEntities, edges, justMap)
  const propMs = Date.now() - propStart

  // Store propagated justifications back
  const propagated = Array.from(justMap.values()).filter(
    (j) => (j as Record<string, unknown>).propagated_feature_tag !== undefined
  )
  if (propagated.length > 0) {
    const storeStart = Date.now()
    await container.graphStore.bulkUpsertJustifications(input.orgId, propagated)
    const storeMs = Date.now() - storeStart
    const totalMs = Date.now() - activityStart
    log.info("Context propagation complete", { propagated: propagated.length, timing: { fetchMs, propMs, storeMs, totalMs } })
    plog.log("info", "Step 6/10", `Context propagation — ${propagated.length} entities enriched | Fetch: ${fetchMs}ms, Propagate: ${propMs}ms, Store: ${storeMs}ms, Total: ${totalMs}ms`)
  } else {
    const totalMs = Date.now() - activityStart
    log.info("Context propagation — no tags to propagate", { timing: { fetchMs, propMs, totalMs } })
    plog.log("info", "Step 6/10", `Context propagation — no tags to propagate (${totalMs}ms)`)
  }
}

/**
 * Compute and store feature aggregations.
 * Fetches all justifications from ArangoDB internally.
 */
export async function storeFeatureAggregations(
  input: JustificationInput
): Promise<void> {
  const container = getContainer()
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "justifying")
  const activityStart = Date.now()
  heartbeat("computing feature aggregations")
  plog.log("info", "Step 7/10", "Computing feature aggregations from justifications...")

  const fetchStart = Date.now()
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const fetchMs = Date.now() - fetchStart

  // Cluster feature tags into higher-level feature areas by shared domain concepts
  const clusterStart = Date.now()
  const areaMap = clusterFeatureAreas(justifications)
  const features = deduplicateFeatures(justifications, input.orgId, input.repoId)
  const clusterMs = Date.now() - clusterStart

  // Annotate features with their area cluster
  for (const f of features) {
    const area = areaMap.get(f.feature_tag)
    if (area) {
      ;(f as unknown as Record<string, unknown>).feature_area = area
    }
  }

  const storeStart = Date.now()
  await container.graphStore.bulkUpsertFeatureAggregations(input.orgId, features)
  const storeMs = Date.now() - storeStart

  const totalMs = Date.now() - activityStart
  log.info("Feature aggregations stored", { justifications: justifications.length, features: features.length, areas: areaMap.size, timing: { fetchMs, clusterMs, storeMs, totalMs } })
  plog.log("info", "Step 7/10", `Feature aggregations — ${features.length} features, ${areaMap.size} areas from ${justifications.length} justifications | Fetch: ${fetchMs}ms, Cluster: ${clusterMs}ms, Store: ${storeMs}ms, Total: ${totalMs}ms`)
}

/**
 * Embed all justifications for a repo into the dedicated justification_embeddings table.
 * Fetches justifications from ArangoDB internally. Stores business context (taxonomy,
 * feature_tag, business_purpose) as first-class columns for efficient filtered search.
 */
export async function embedJustifications(
  input: JustificationInput
): Promise<number> {
  const container = getContainer()
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  const plog = pipelineLogger(input, "justifying")
  const activityStart = Date.now()

  const fetchStart = Date.now()
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const fetchMs = Date.now() - fetchStart
  heartbeat(`embedding ${justifications.length} justifications`)
  plog.log("info", "Step 8/10", `Generating vector embeddings for ${justifications.length} justifications (fetch: ${fetchMs}ms)...`)

  if (justifications.length === 0) {
    plog.log("info", "Step 8/10", "No justifications to embed — skipping")
    return 0
  }

  // Load entities to resolve entity names (justifications only store entity_id)
  const allEntities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const entityMap = new Map(allEntities.map((e) => [e.id, e]))
  heartbeat(`loaded ${allEntities.length} entities for name resolution`)

  // Check if the adapter supports dedicated justification embeddings
  if (!container.vectorSearch.upsertJustificationEmbeddings) {
    logger.warn("vectorSearch adapter does not support upsertJustificationEmbeddings — skipping", {
      service: "justification",
      repoId: input.repoId,
    })
    return 0
  }

  // Process in chunks of 20 to avoid accumulating all embeddings in memory
  const CHUNK_SIZE = 20
  let totalStored = 0

  for (let i = 0; i < justifications.length; i += CHUNK_SIZE) {
    const chunk = justifications.slice(i, i + CHUNK_SIZE)

    // Build rich text for embedding — includes entity name, kind, signature, source, and justification
    const texts = chunk.map((j) => {
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
      // Include first 500 chars of body for semantic richness
      if (entity?.body) {
        const bodySnippet = String(entity.body).slice(0, 500)
        parts.push(bodySnippet)
      }
      // Cap total text at 1500 chars to keep embedding focused
      const text = parts.join("\n")
      return text.length > 1500 ? text.slice(0, 1500) : text
    })

    const embeddings = await container.vectorSearch.embed(texts)

    // Build typed metadata matching justification_embeddings table schema
    const metadata = chunk.map((j) => {
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
    totalStored += chunk.length

    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1
    const totalChunks = Math.ceil(justifications.length / CHUNK_SIZE)
    if (global.gc) global.gc()
    heartbeat(`embedded justification chunk ${chunkNum}/${totalChunks}`)
    // Log progress every 5 chunks to avoid spamming
    if (chunkNum % 5 === 0 || chunkNum === totalChunks) {
      plog.log("info", "Step 8/10", `Embedded ${totalStored}/${justifications.length} justifications (chunk ${chunkNum}/${totalChunks})`)
    }
  }

  const totalMs = Date.now() - activityStart
  log.info("Justification embedding complete", { totalStored, totalChunks: Math.ceil(justifications.length / CHUNK_SIZE), timing: { fetchMs, totalMs } })
  plog.log("info", "Step 8/10", `Embedding complete — ${totalStored} vectors | Fetch: ${fetchMs}ms, Total: ${totalMs}ms`)
  return totalStored
}

/**
 * Refine ontology by merging newly discovered domain_concepts from recent justifications.
 * Called periodically during justification (e.g., every 20 topo levels) to keep
 * the ontology fresh as more entities are classified.
 */
export async function refineOntologyWithNewConcepts(
  input: JustificationInput
): Promise<{ newTermsAdded: number }> {
  const container = getContainer()
  heartbeat("refining ontology with new concepts")

  const [ontology, justifications] = await Promise.all([
    container.graphStore.getDomainOntology(input.orgId, input.repoId),
    container.graphStore.getJustifications(input.orgId, input.repoId),
  ])

  if (!ontology || justifications.length === 0) return { newTermsAdded: 0 }

  // Collect all domain_concepts from justifications
  const conceptFreq = new Map<string, number>()
  for (const j of justifications) {
    for (const concept of j.domain_concepts) {
      const normalized = concept.toLowerCase().trim()
      if (normalized.length > 1) {
        conceptFreq.set(normalized, (conceptFreq.get(normalized) ?? 0) + 1)
      }
    }
  }

  // Find concepts that appear at least 3 times but aren't in the ontology yet
  const existingTerms = new Set(ontology.terms.map((t) => t.term.toLowerCase()))
  const newConcepts: Array<{ term: string; frequency: number; relatedTerms: string[] }> = []

  for (const [concept, freq] of Array.from(conceptFreq.entries())) {
    if (freq >= 3 && !existingTerms.has(concept)) {
      newConcepts.push({ term: concept, frequency: freq, relatedTerms: [] })
    }
  }

  if (newConcepts.length === 0) return { newTermsAdded: 0 }

  // Merge new terms into existing ontology
  const updatedOntology = {
    ...ontology,
    terms: [...ontology.terms, ...newConcepts.slice(0, 50)], // Cap at 50 new terms per refinement
    generated_at: new Date().toISOString(),
  }

  await container.graphStore.upsertDomainOntology(input.orgId, updatedOntology)
  return { newTermsAdded: Math.min(newConcepts.length, 50) }
}

export async function setJustifyDoneStatus(input: JustificationInput): Promise<void> {
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  log.info("Justification complete, setting repo status to ready")
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "ready",
    lastIndexedAt: new Date(),
  })
}

export async function setJustifyFailedStatus(
  repoId: string,
  errorMessage: string
): Promise<void> {
  logger.error("Justification failed", undefined, { service: "justification", repoId, errorMessage })
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(repoId, {
    status: "justify_failed",
    errorMessage,
  })
}

/**
 * L-14: Warm the entity profile cache in Redis after justification completes.
 * Builds profiles for all entities and stores them with 24h TTL.
 */
export async function warmEntityProfileCache(
  input: JustificationInput,
): Promise<{ profilesWarmed: number }> {
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  const container = getContainer()

  const { buildEntityProfiles, cacheEntityProfiles } = require("@/lib/mcp/entity-profile") as typeof import("@/lib/mcp/entity-profile")

  heartbeat("building entity profiles for cache")
  const profiles = await buildEntityProfiles(input.orgId, input.repoId, container)

  heartbeat(`caching ${profiles.size} profiles`)
  const cached = await cacheEntityProfiles(input.orgId, input.repoId, profiles, container)

  log.info("Entity profile cache warmed", { profilesWarmed: cached })
  return { profilesWarmed: cached }
}
