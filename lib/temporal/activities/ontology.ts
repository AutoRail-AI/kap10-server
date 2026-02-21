/**
 * Phase 4: Ontology discovery activities.
 * Extracts domain terms, refines with LLM, stores in ArangoDB.
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import { extractDomainTerms, buildOntologyPrompt } from "@/lib/justification/ontology-extractor"
import { DomainOntologySchema } from "@/lib/justification/schemas"
import type { EntityDoc, DomainOntologyDoc } from "@/lib/ports/types"
import { randomUUID } from "node:crypto"

export interface OntologyInput {
  orgId: string
  repoId: string
}

export async function fetchEntitiesForOntology(input: OntologyInput): Promise<EntityDoc[]> {
  const container = getContainer()
  heartbeat("fetching entities for ontology")
  return container.graphStore.getAllEntities(input.orgId, input.repoId)
}

export async function extractAndRefineOntology(
  input: OntologyInput,
  entities: EntityDoc[]
): Promise<DomainOntologyDoc> {
  const container = getContainer()
  heartbeat("extracting domain terms")

  // Step 1: Extract raw terms
  const rawTerms = extractDomainTerms(entities)
  heartbeat(`found ${rawTerms.length} domain terms`)

  // Step 2: Build LLM prompt
  const prompt = buildOntologyPrompt(rawTerms, entities)

  // Step 3: Refine with LLM
  const defaultModel = process.env.LLM_DEFAULT_MODEL ?? "gpt-4o-mini"
  const schema = DomainOntologySchema.pick({ terms: true, ubiquitousLanguage: true })

  let terms = rawTerms.map((t) => ({ ...t, relatedTerms: [] as string[] }))
  let ubiquitousLanguage: Record<string, string> = {}

  try {
    const result = await container.llmProvider.generateObject({
      model: defaultModel,
      schema,
      prompt,
    })
    terms = result.object.terms ?? terms
    ubiquitousLanguage = result.object.ubiquitousLanguage ?? {}
    heartbeat("LLM refinement complete")
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[ontology] LLM refinement failed, using raw terms: ${message}`)
  }

  return {
    id: randomUUID(),
    org_id: input.orgId,
    repo_id: input.repoId,
    terms,
    ubiquitous_language: ubiquitousLanguage,
    generated_at: new Date().toISOString(),
  }
}

export async function storeOntology(
  input: OntologyInput,
  ontology: DomainOntologyDoc
): Promise<void> {
  const container = getContainer()
  heartbeat("storing ontology")
  await container.graphStore.upsertDomainOntology(input.orgId, ontology)
}
