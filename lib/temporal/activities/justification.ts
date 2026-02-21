/**
 * Phase 4: Justification activities — the core pipeline activities
 * for classifying entities with business justifications.
 */

import { heartbeat } from "@temporalio/activity"
import { randomUUID } from "node:crypto"
import { getContainer } from "@/lib/di/container"
import { buildGraphContexts } from "@/lib/justification/graph-context-builder"
import { applyHeuristics, routeModel } from "@/lib/justification/model-router"
import { normalizeJustifications, deduplicateFeatures } from "@/lib/justification/post-processor"
import { buildJustificationPrompt } from "@/lib/justification/prompt-builder"
import { JustificationResultSchema } from "@/lib/justification/schemas"
import { buildTestContext } from "@/lib/justification/test-context-extractor"
import { topologicalSortEntities } from "@/lib/justification/topological-sort"
import type { DomainOntologyDoc, EdgeDoc, EntityDoc, JustificationDoc } from "@/lib/ports/types"

export interface JustificationInput {
  orgId: string
  repoId: string
}

export async function setJustifyingStatus(input: JustificationInput): Promise<void> {
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "justifying",
  })
}

export async function fetchEntitiesAndEdges(
  input: JustificationInput
): Promise<{ entities: EntityDoc[]; edges: EdgeDoc[] }> {
  const container = getContainer()
  heartbeat("fetching entities and edges")
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  const edges = await container.graphStore.getAllEdges(input.orgId, input.repoId)
  return { entities, edges }
}

export async function loadOntology(
  input: JustificationInput
): Promise<DomainOntologyDoc | null> {
  const container = getContainer()
  return container.graphStore.getDomainOntology(input.orgId, input.repoId)
}

/**
 * Justify a batch of entities at a specific topological level.
 * Uses model router for tier selection, builds prompts with graph context,
 * and calls LLM for non-heuristic entities.
 */
export async function justifyBatch(
  input: JustificationInput,
  entities: EntityDoc[],
  edges: EdgeDoc[],
  ontology: DomainOntologyDoc | null,
  previousJustifications: JustificationDoc[]
): Promise<JustificationDoc[]> {
  const container = getContainer()
  const results: JustificationDoc[] = []

  // Build graph contexts for this batch
  heartbeat(`building graph contexts for ${entities.length} entities`)
  const graphContexts = await buildGraphContexts(
    entities,
    container.graphStore,
    input.orgId
  )

  // Build a lookup for previous justifications by entity_id
  const prevJustMap = new Map<string, JustificationDoc>()
  for (const j of previousJustifications) {
    prevJustMap.set(j.entity_id, j)
  }

  const defaultModel = process.env.LLM_DEFAULT_MODEL ?? "gpt-4o-mini"

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!
    heartbeat(`justifying entity ${i + 1}/${entities.length}: ${entity.name}`)

    const now = new Date().toISOString()
    const graphContext = graphContexts.get(entity.id)

    // Step 1: Try heuristics
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
    const testContext = buildTestContext(entity.id, entities, edges)

    // Step 4: Gather dependency justifications
    const depJustifications: JustificationDoc[] = []
    if (graphContext) {
      for (const neighbor of graphContext.neighbors) {
        if (neighbor.direction === "outbound") {
          const j = prevJustMap.get(neighbor.id)
          if (j) depJustifications.push(j)
        }
      }
    }

    // Step 5: Build prompt and call LLM
    const prompt = buildJustificationPrompt(
      entity,
      graphContext ?? { entityId: entity.id, neighbors: [] },
      ontology,
      depJustifications,
      testContext
    )

    try {
      const modelToUse = route.model ?? defaultModel
      const llmResult = await container.llmProvider.generateObject({
        model: modelToUse,
        schema: JustificationResultSchema,
        prompt,
        temperature: 0.1,
      })

      results.push({
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
        model_tier: route.tier,
        model_used: modelToUse,
        valid_from: now,
        valid_to: null,
        created_at: now,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[justifyBatch] LLM failed for ${entity.name}: ${message}`)
      // Fallback: mark as UTILITY with low confidence
      results.push({
        id: randomUUID(),
        org_id: input.orgId,
        repo_id: input.repoId,
        entity_id: entity.id,
        taxonomy: "UTILITY",
        confidence: 0.3,
        business_purpose: `Classification failed: ${message}`,
        domain_concepts: [],
        feature_tag: "unclassified",
        semantic_triples: [],
        compliance_tags: [],
        model_tier: route.tier,
        model_used: route.model,
        valid_from: now,
        valid_to: null,
        created_at: now,
      })
    }
  }

  return results
}

export async function storeJustifications(
  input: JustificationInput,
  justifications: JustificationDoc[]
): Promise<void> {
  const container = getContainer()
  heartbeat(`storing ${justifications.length} justifications`)
  const normalized = normalizeJustifications(justifications)
  await container.graphStore.bulkUpsertJustifications(input.orgId, normalized)
}

export async function storeFeatureAggregations(
  input: JustificationInput,
  justifications: JustificationDoc[]
): Promise<void> {
  const container = getContainer()
  heartbeat("computing feature aggregations")
  const features = deduplicateFeatures(justifications, input.orgId, input.repoId)
  await container.graphStore.bulkUpsertFeatureAggregations(input.orgId, features)
}

export async function embedJustifications(
  input: JustificationInput,
  justifications: JustificationDoc[]
): Promise<number> {
  const container = getContainer()
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
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(input.repoId, {
    status: "ready",
  })
}

export async function setJustifyFailedStatus(
  repoId: string,
  errorMessage: string
): Promise<void> {
  const container = getContainer()
  await container.relationalStore.updateRepoStatus(repoId, {
    status: "justify_failed",
    errorMessage,
  })
}

export async function performTopologicalSort(
  entities: EntityDoc[],
  edges: EdgeDoc[]
): Promise<EntityDoc[][]> {
  heartbeat("performing topological sort")
  return topologicalSortEntities(entities, edges)
}
