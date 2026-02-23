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
import { logger } from "@/lib/utils/logger"
import { buildGraphContexts } from "@/lib/justification/graph-context-builder"
import { applyHeuristics, routeModel } from "@/lib/justification/model-router"
import { normalizeJustifications, deduplicateFeatures } from "@/lib/justification/post-processor"
import {
  buildJustificationPrompt,
  buildBatchJustificationPrompt,
  JUSTIFICATION_SYSTEM_PROMPT,
} from "@/lib/justification/prompt-builder"
import { JustificationResultSchema, BatchJustificationResultSchema } from "@/lib/justification/schemas"
import { buildTestContext } from "@/lib/justification/test-context-extractor"
import { topologicalSortEntityIds } from "@/lib/justification/topological-sort"
import { createBatches, getBatcherConfigForModel } from "@/lib/justification/dynamic-batcher"
import { checkStaleness, computeBodyHash } from "@/lib/justification/staleness-checker"
import { detectDeadCode } from "@/lib/justification/dead-code-detector"
import { scoreJustification } from "@/lib/justification/quality-scorer"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"
import type { GraphContext } from "@/lib/justification/schemas"

export interface JustificationInput {
  orgId: string
  repoId: string
}

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
 * Perform topological sort by fetching entities/edges from ArangoDB.
 * Returns string[][] (entity ID arrays per level) to keep payload small.
 */
export async function performTopologicalSort(
  input: JustificationInput
): Promise<string[][]> {
  heartbeat("performing topological sort")
  const container = getContainer()
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)
  return topologicalSortEntityIds(entities, edges)
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
 * Justify a batch of entities by their IDs.
 * Fetches all needed data (entities, edges, ontology, previous justifications)
 * from ArangoDB internally. Uses dynamic batching to minimize LLM calls.
 * Stores results directly before returning a count.
 */
export async function justifyBatch(
  input: JustificationInput,
  entityIds: string[],
  calleeChangedIds: string[] = []
): Promise<{ justifiedCount: number; changedEntityIds: string[] }> {
  const container = getContainer()
  const results: JustificationDoc[] = []

  // Fetch all data needed for this batch from ArangoDB
  heartbeat(`fetching data for ${entityIds.length} entities`)
  const allEntities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)
  const ontology = await container.graphStore.getDomainOntology(input.orgId, input.repoId)
  const previousJustifications = await container.graphStore.getJustifications(input.orgId, input.repoId)

  // Filter to just the entities in this batch
  const entityIdSet = new Set(entityIds)
  let entities = allEntities.filter((e) => entityIdSet.has(e.id))

  // Build lookup maps early for staleness check
  const prevJustMap = new Map<string, JustificationDoc>()
  for (const j of previousJustifications) {
    prevJustMap.set(j.entity_id, j)
  }

  // Staleness detection: skip unchanged entities
  const calleeChangedSet = new Set(calleeChangedIds)
  const { stale, fresh } = checkStaleness(entities, prevJustMap, calleeChangedSet, edges)
  if (fresh.length > 0) {
    heartbeat(`skipping ${fresh.length} fresh entities (unchanged since last justification)`)
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

  const { LLM_MODELS } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")
  const defaultModel = LLM_MODELS.standard

  // Dead code detection: auto-classify entities with zero inbound references
  const deadCodeIds = detectDeadCode(allEntities, edges)

  // Separate entities into heuristic-skippable and LLM-required
  const llmEntities: Array<{
    entity: EntityDoc
    graphContext: GraphContext
    testContext: import("@/lib/justification/types").TestContext | undefined
    depJustifications: JustificationDoc[]
    callerJustifications: JustificationDoc[]
    route: import("@/lib/justification/schemas").ModelRoute
    parentJustification?: JustificationDoc
    siblingNames?: string[]
  }> = []

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!
    heartbeat(`processing entity ${i + 1}/${entities.length}: ${entity.name}`)

    const now = new Date().toISOString()
    const graphContext = graphContexts.get(entity.id)

    // Step 1a: Check dead code (no inbound references, not exported)
    if (deadCodeIds.has(entity.id)) {
      results.push({
        id: randomUUID(),
        org_id: input.orgId,
        repo_id: input.repoId,
        entity_id: entity.id,
        taxonomy: "UTILITY",
        confidence: 0.7,
        business_purpose: "Potentially dead code: no inbound references detected in the call graph",
        domain_concepts: [],
        feature_tag: "dead_code",
        semantic_triples: [],
        compliance_tags: [],
        model_tier: "heuristic",
        valid_from: now,
        valid_to: null,
        created_at: now,
      })
      continue
    }

    // Step 1b: Try heuristics
    const heuristic = applyHeuristics(entity)
    if (heuristic) {
      results.push({
        id: randomUUID(),
        org_id: input.orgId,
        repo_id: input.repoId,
        entity_id: entity.id,
        taxonomy: heuristic.taxonomy,
        confidence: heuristic.confidence,
        business_purpose: heuristic.businessPurpose,
        domain_concepts: [],
        feature_tag: heuristic.featureTag,
        semantic_triples: [],
        compliance_tags: [],
        model_tier: "heuristic",
        valid_from: now,
        valid_to: null,
        created_at: now,
      })
      continue
    }

    // Step 2: Route model
    const route = routeModel(entity, {
      centrality: graphContext?.centrality,
    })

    // Step 3: Build test context
    const testContext = buildTestContext(entity.id, allEntities, edges)

    // Step 4: Gather dependency justifications (split by direction)
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

    llmEntities.push({
      entity,
      graphContext: graphContext ?? { entityId: entity.id, neighbors: [] },
      testContext,
      depJustifications: calleeJustifications,
      callerJustifications,
      route,
      parentJustification: parentJustMap.get(entity.id),
      siblingNames: siblingMap.get(entity.id),
    })
  }

  // Dynamic batching for LLM entities
  // Group by model tier for batching (don't mix premium with fast)
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

  for (const tier of Array.from(byTier.keys())) {
    const tierEntities = byTier.get(tier)!
    const modelToUse = tierEntities[0]?.route.model ?? defaultModel

    // Create token-budgeted batches with model-aware limits
    const batcherConfig = getBatcherConfigForModel(modelToUse)
    const batches = createBatches(
      tierEntities.map((te) => ({
        entity: te.entity,
        graphContext: te.graphContext,
        parentJustification: te.parentJustification,
      })),
      batcherConfig
    )

    heartbeat(`processing ${batches.length} batches for tier ${tier} (${tierEntities.length} entities)`)

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]!
      heartbeat(`LLM batch ${batchIdx + 1}/${batches.length} (${batch.entities.length} entities, tier: ${tier})`)

      const now = new Date().toISOString()

      if (batch.entities.length === 1) {
        // Single entity — use individual prompt (richer context)
        const be = batch.entities[0]!
        const teInfo = tierEntities.find((te) => te.entity.id === be.entity.id)!

        const prompt = buildJustificationPrompt(
          be.entity,
          be.graphContext,
          ontology,
          teInfo.depJustifications,
          teInfo.testContext,
          {
            entityNameMap,
            parentJustification: teInfo.parentJustification,
            siblingNames: teInfo.siblingNames,
            modelTier: tier === "premium" ? "premium" : tier === "fast" ? "fast" : "standard",
            callerJustifications: teInfo.callerJustifications,
          }
        )

        try {
          const llmResult = await container.llmProvider.generateObject({
            model: modelToUse,
            schema: JustificationResultSchema,
            prompt,
            system: JUSTIFICATION_SYSTEM_PROMPT,
            temperature: 0.1,
          })

          results.push({
            id: randomUUID(),
            org_id: input.orgId,
            repo_id: input.repoId,
            entity_id: be.entity.id,
            taxonomy: llmResult.object.taxonomy,
            confidence: llmResult.object.confidence,
            business_purpose: llmResult.object.businessPurpose,
            domain_concepts: llmResult.object.domainConcepts,
            feature_tag: llmResult.object.featureTag,
            semantic_triples: llmResult.object.semanticTriples,
            compliance_tags: llmResult.object.complianceTags ?? [],
            architectural_pattern: llmResult.object.architecturalPattern,
            model_tier: tier as JustificationDoc["model_tier"],
            model_used: modelToUse,
            valid_from: now,
            valid_to: null,
            created_at: now,
          })
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[justifyBatch] LLM failed for ${be.entity.name}: ${message}`)
          results.push(createFallbackJustification(input, be.entity.id, tier, modelToUse, message, now))
        }
      } else {
        // Multi-entity batch — use batch prompt
        const batchPrompt = buildBatchJustificationPrompt(
          batch.entities.map((be) => {
            const teInfo = tierEntities.find((te) => te.entity.id === be.entity.id)
            return {
              entity: be.entity,
              graphContext: be.graphContext,
              parentJustification: be.parentJustification,
              calleeJustifications: teInfo?.depJustifications,
            }
          }),
          ontology,
          entityNameMap
        )

        try {
          const llmResult = await container.llmProvider.generateObject({
            model: modelToUse,
            schema: BatchJustificationResultSchema,
            prompt: batchPrompt,
            system: JUSTIFICATION_SYSTEM_PROMPT,
            temperature: 0.1,
          })

          // Match results to entities
          const batchResults = llmResult.object
          for (const be of batch.entities) {
            const match = batchResults.find((r) => r.entityId === be.entity.id)
            if (match) {
              results.push({
                id: randomUUID(),
                org_id: input.orgId,
                repo_id: input.repoId,
                entity_id: be.entity.id,
                taxonomy: match.taxonomy,
                confidence: match.confidence,
                business_purpose: match.businessPurpose,
                domain_concepts: match.domainConcepts,
                feature_tag: match.featureTag,
                semantic_triples: match.semanticTriples,
                compliance_tags: match.complianceTags ?? [],
                architectural_pattern: match.architecturalPattern,
                model_tier: tier as JustificationDoc["model_tier"],
                model_used: modelToUse,
                valid_from: now,
                valid_to: null,
                created_at: now,
              })
            } else {
              // Entity not found in batch response — retry individually
              console.warn(`[justifyBatch] Entity ${be.entity.name} missing from batch response, retrying individually`)
              await retrySingleEntity(container, input, be, ontology, tierEntities, entityNameMap, prevJustMap, modelToUse, tier, results, now)
            }
          }
        } catch (error: unknown) {
          // Batch failed — retry each entity individually
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[justifyBatch] Batch LLM failed (${batch.entities.length} entities): ${message}. Retrying individually.`)

          for (const be of batch.entities) {
            await retrySingleEntity(container, input, be, ontology, tierEntities, entityNameMap, prevJustMap, modelToUse, tier, results, now)
          }
        }
      }
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
  return { justifiedCount: results.length, changedEntityIds }
}

/** Retry a single entity that failed in a batch */
async function retrySingleEntity(
  container: ReturnType<typeof getContainer>,
  input: JustificationInput,
  be: { entity: EntityDoc; graphContext: GraphContext; parentJustification?: JustificationDoc },
  ontology: import("@/lib/ports/types").DomainOntologyDoc | null,
  tierEntities: Array<{
    entity: EntityDoc
    depJustifications: JustificationDoc[]
    callerJustifications: JustificationDoc[]
    testContext: import("@/lib/justification/types").TestContext | undefined
    siblingNames?: string[]
    parentJustification?: JustificationDoc
  }>,
  entityNameMap: Map<string, string>,
  prevJustMap: Map<string, JustificationDoc>,
  modelToUse: string,
  tier: string,
  results: JustificationDoc[],
  now: string
): Promise<void> {
  const teInfo = tierEntities.find((te) => te.entity.id === be.entity.id)
  const prompt = buildJustificationPrompt(
    be.entity,
    be.graphContext,
    ontology,
    teInfo?.depJustifications ?? [],
    teInfo?.testContext,
    {
      entityNameMap,
      parentJustification: be.parentJustification,
      siblingNames: teInfo?.siblingNames,
      callerJustifications: teInfo?.callerJustifications,
    }
  )

  try {
    const llmResult = await container.llmProvider.generateObject({
      model: modelToUse,
      schema: JustificationResultSchema,
      prompt,
      system: JUSTIFICATION_SYSTEM_PROMPT,
      temperature: 0.1,
    })

    results.push({
      id: randomUUID(),
      org_id: input.orgId,
      repo_id: input.repoId,
      entity_id: be.entity.id,
      taxonomy: llmResult.object.taxonomy,
      confidence: llmResult.object.confidence,
      business_purpose: llmResult.object.businessPurpose,
      domain_concepts: llmResult.object.domainConcepts,
      feature_tag: llmResult.object.featureTag,
      semantic_triples: llmResult.object.semanticTriples,
      compliance_tags: llmResult.object.complianceTags ?? [],
      architectural_pattern: llmResult.object.architecturalPattern,
      model_tier: tier as JustificationDoc["model_tier"],
      model_used: modelToUse,
      valid_from: now,
      valid_to: null,
      created_at: now,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[justifyBatch] Individual retry failed for ${be.entity.name}: ${message}`)
    results.push(createFallbackJustification(input, be.entity.id, tier, modelToUse, message, now))
  }
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
  return {
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
  heartbeat("propagating context across entity hierarchy")

  const [allEntities, edges, justifications] = await Promise.all([
    container.graphStore.getAllEntities(input.orgId, input.repoId),
    container.graphStore.getAllEdges(input.orgId, input.repoId),
    container.graphStore.getJustifications(input.orgId, input.repoId),
  ])

  if (justifications.length === 0) return

  const justMap = new Map<string, JustificationDoc>()
  for (const j of justifications) {
    justMap.set(j.entity_id, j)
  }

  propagateContext(allEntities, edges, justMap)

  // Store propagated justifications back
  const propagated = Array.from(justMap.values()).filter(
    (j) => (j as Record<string, unknown>).propagated_feature_tag !== undefined
  )
  if (propagated.length > 0) {
    await container.graphStore.bulkUpsertJustifications(input.orgId, propagated)
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
  heartbeat("computing feature aggregations")
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  const features = deduplicateFeatures(justifications, input.orgId, input.repoId)
  await container.graphStore.bulkUpsertFeatureAggregations(input.orgId, features)
}

/**
 * Embed all justifications for a repo.
 * Fetches justifications from ArangoDB internally.
 */
export async function embedJustifications(
  input: JustificationInput
): Promise<number> {
  const container = getContainer()
  const justifications = await container.graphStore.getJustifications(input.orgId, input.repoId)
  heartbeat(`embedding ${justifications.length} justifications`)

  if (justifications.length === 0) return 0

  // Build embeddable text from business purpose + domain concepts
  const texts = justifications.map(
    (j) => `${j.taxonomy}: ${j.business_purpose}. Concepts: ${j.domain_concepts.join(", ")}. Feature: ${j.feature_tag}`
  )

  const embeddings = await container.vectorSearch.embed(texts)

  const ids = justifications.map((j) => `just_${j.entity_id}`)
  const metadata = justifications.map((j) => ({
    orgId: j.org_id,
    repoId: j.repo_id,
    entityId: j.entity_id,
    taxonomy: j.taxonomy,
    featureTag: j.feature_tag,
  }))

  await container.vectorSearch.upsert(ids, embeddings, metadata)

  return justifications.length
}

export async function setJustifyDoneStatus(input: JustificationInput): Promise<void> {
  const log = logger.child({ service: "justification", organizationId: input.orgId, repoId: input.repoId })
  log.info("Justification complete, setting repo status to ready")
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "ready",
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
