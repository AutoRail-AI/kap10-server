/**
 * Phase 4: Ontology discovery activities.
 * Extracts domain terms, refines with LLM, stores in ArangoDB.
 */

import { heartbeat } from "@temporalio/activity"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { getContainer } from "@/lib/di/container"
import { extractDomainTerms, buildOntologyPrompt } from "@/lib/justification/ontology-extractor"
import { DomainOntologySchema } from "@/lib/justification/schemas"
import type { EntityDoc, DomainOntologyDoc } from "@/lib/ports/types"
import { logger } from "@/lib/utils/logger"

export interface OntologyInput {
  orgId: string
  repoId: string
}

/** @deprecated Use discoverAndStoreOntology instead. */
export async function fetchEntitiesForOntology(input: OntologyInput): Promise<EntityDoc[]> {
  const container = getContainer()
  heartbeat("fetching entities for ontology")
  return container.graphStore.getAllEntities(input.orgId, input.repoId)
}

/**
 * Combined activity: fetch entities, extract ontology, refine with LLM, and store.
 * All heavy data stays inside the worker — only a term count crosses Temporal.
 */
export async function discoverAndStoreOntology(
  input: OntologyInput,
): Promise<{ termCount: number }> {
  const log = logger.child({ service: "ontology", organizationId: input.orgId, repoId: input.repoId })
  const container = getContainer()

  heartbeat("fetching entities for ontology")
  const entities = await container.graphStore.getAllEntities(input.orgId, input.repoId)
  log.info("Fetched entities for ontology", { entityCount: entities.length })

  heartbeat("extracting and refining ontology")
  const ontology = await extractAndRefineOntologyInternal(input, entities)
  log.info("Ontology refined", { termCount: ontology.terms.length })

  heartbeat("storing ontology")
  await container.graphStore.upsertDomainOntology(input.orgId, ontology)
  log.info("Ontology stored")

  return { termCount: ontology.terms.length }
}

/** @deprecated Use discoverAndStoreOntology instead. */
export async function extractAndRefineOntology(
  input: OntologyInput,
  entities: EntityDoc[]
): Promise<DomainOntologyDoc> {
  return extractAndRefineOntologyInternal(input, entities)
}

async function extractAndRefineOntologyInternal(
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
  const { LLM_MODELS } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")
  const defaultModel = LLM_MODELS.standard
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
    const log = logger.child({ service: "ontology", organizationId: input.orgId, repoId: input.repoId })
    log.warn("LLM refinement failed, using raw terms", {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }

  // Extract project-level context from workspace manifest files
  const projectContext = extractProjectContext(input.orgId, input.repoId)

  return {
    id: randomUUID(),
    org_id: input.orgId,
    repo_id: input.repoId,
    terms,
    ubiquitous_language: ubiquitousLanguage,
    ...projectContext,
    generated_at: new Date().toISOString(),
  }
}

/**
 * Extract project-level context from manifest files (package.json, pyproject.toml, go.mod).
 * Returns partial DomainOntologyDoc fields for project context.
 */
function extractProjectContext(
  orgId: string,
  repoId: string
): Pick<DomainOntologyDoc, "project_name" | "project_description" | "project_domain" | "tech_stack"> {
  const workspacePath = `/data/workspaces/${orgId}/${repoId}`
  const result: Pick<DomainOntologyDoc, "project_name" | "project_description" | "project_domain" | "tech_stack"> = {}

  // Try package.json first (Node.js / JS/TS projects)
  try {
    const content = readFileSync(`${workspacePath}/package.json`, "utf-8")
    const pkg = JSON.parse(content) as Record<string, unknown>
    if (pkg.name && typeof pkg.name === "string") result.project_name = pkg.name
    if (pkg.description && typeof pkg.description === "string") result.project_description = pkg.description

    // Extract tech stack from dependencies
    const deps = { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) }
    const techStack: string[] = []
    const knownFrameworks: Record<string, string> = {
      next: "Next.js", react: "React", vue: "Vue", angular: "@angular/core",
      express: "Express", fastify: "Fastify", prisma: "Prisma",
      "@supabase/supabase-js": "Supabase", "better-auth": "Better Auth",
      tailwindcss: "Tailwind CSS", "@temporalio/client": "Temporal",
    }
    for (const [dep, label] of Object.entries(knownFrameworks)) {
      if (dep in deps) techStack.push(label)
    }
    if (techStack.length > 0) result.tech_stack = techStack
  } catch {
    // Not a Node.js project or file not readable
  }

  // Try pyproject.toml (Python projects)
  if (!result.project_name) {
    try {
      const content = readFileSync(`${workspacePath}/pyproject.toml`, "utf-8")
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m)
      const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m)
      if (nameMatch) result.project_name = nameMatch[1]
      if (descMatch) result.project_description = descMatch[1]
    } catch {
      // Not a Python project
    }
  }

  // Try go.mod (Go projects)
  if (!result.project_name) {
    try {
      const content = readFileSync(`${workspacePath}/go.mod`, "utf-8")
      const moduleMatch = content.match(/^module\s+(.+)$/m)
      if (moduleMatch) {
        const modulePath = moduleMatch[1]!.trim()
        result.project_name = modulePath.split("/").pop() ?? modulePath
      }
    } catch {
      // Not a Go project
    }
  }

  return result
}

export async function storeOntology(
  input: OntologyInput,
  ontology: DomainOntologyDoc
): Promise<void> {
  const log = logger.child({ service: "ontology", organizationId: input.orgId, repoId: input.repoId })
  log.info("Storing ontology", { termCount: ontology.terms.length })
  const container = getContainer()
  heartbeat("storing ontology")
  await container.graphStore.upsertDomainOntology(input.orgId, ontology)
}
