/**
 * Phase 4: Prompt Builder — constructs LLM prompts for entity justification
 * anchored in graph context, domain ontology, and proven dependency justifications.
 */

import type { EntityDoc, DomainOntologyDoc, JustificationDoc } from "@/lib/ports/types"
import type { GraphContext } from "./schemas"
import type { TestContext } from "./types"

/**
 * System prompt preamble for justification LLM calls.
 * Sets quality expectations and anti-pattern guidance.
 */
export const JUSTIFICATION_SYSTEM_PROMPT = `You are a senior software architect analyzing source code entities to classify their business purpose.

## Quality Rules

1. **Be specific, not generic.** Never say "Function that does X" or "Type interface defining Y" or "Handles X-related operations". Instead, explain the concrete business action: "Validates payment card numbers against Luhn algorithm before processing charges."

2. **Use precise action verbs.** Start businessPurpose with verbs like: validates, orchestrates, transforms, persists, aggregates, routes, authorizes, schedules, reconciles, normalizes, encrypts, dispatches, throttles.

3. **Explain the business WHY, not the technical HOW.** Bad: "Calls the database and returns a user object." Good: "Retrieves customer profile data to personalize the checkout experience."

4. **Classify architectural patterns.** When relevant, note if the entity is:
   - pure_domain: Contains only business rules, no infrastructure
   - pure_infrastructure: Database, HTTP, messaging, file I/O only
   - adapter: Translates between domain and infrastructure
   - mixed: Contains both domain logic AND infrastructure concerns (this often indicates a code smell worth noting)

5. **Detect mixed responsibilities.** If an entity both implements business rules AND handles infrastructure (e.g., validates input AND writes to database), set confidence lower (0.5-0.7) and note the mixed concern in businessPurpose.

6. **Domain concepts must be meaningful.** Don't list generic programming terms like "function", "class", "string". List actual domain terms like "order", "payment", "authentication", "subscription".

7. **Feature tags should group related entities.** Use consistent snake_case tags that map to product features: "user_auth", "payment_processing", "order_management", "notification_system", "inventory_tracking".
`

export interface PromptBuilderOptions {
  /** Map of entity ID → human-readable name for dependency references */
  entityNameMap?: Map<string, string>
  /** Parent entity's justification (e.g., class justification for a method) */
  parentJustification?: JustificationDoc
  /** Names of sibling entities (e.g., other methods in the same class) */
  siblingNames?: string[]
  /** Model tier — controls body truncation limit */
  modelTier?: "fast" | "standard" | "premium"
  /** Justifications from entities that depend on this entity (callers/inbound) */
  callerJustifications?: JustificationDoc[]
}

/**
 * Build a justification prompt for a single entity.
 */
export function buildJustificationPrompt(
  entity: EntityDoc,
  graphContext: GraphContext,
  ontology: DomainOntologyDoc | null,
  dependencyJustifications: JustificationDoc[],
  testContext?: TestContext,
  options?: PromptBuilderOptions
): string {
  const sections: string[] = []

  // Determine body truncation limit based on model tier
  const maxBodyChars = options?.modelTier === "fast" ? 1500
    : options?.modelTier === "premium" ? 4000
    : 3000

  // Section 0: Project context (if available from ontology)
  if (ontology && (ontology.project_name || ontology.project_description)) {
    const projectLines: string[] = []
    if (ontology.project_name) projectLines.push(`Project: ${ontology.project_name}`)
    if (ontology.project_description) projectLines.push(`Description: ${ontology.project_description}`)
    if (ontology.project_domain) projectLines.push(`Domain: ${ontology.project_domain}`)
    if (ontology.tech_stack && ontology.tech_stack.length > 0) projectLines.push(`Tech stack: ${ontology.tech_stack.join(", ")}`)
    sections.push(`## Project Context\n${projectLines.join("\n")}`)
  }

  // Section 1: Entity details
  const metadataLines: string[] = []
  if (entity.is_async) metadataLines.push("- **Async**: yes")
  if (entity.parameter_count != null) metadataLines.push(`- **Parameters**: ${entity.parameter_count as number}`)
  if (entity.return_type) metadataLines.push(`- **Returns**: ${entity.return_type as string}`)
  if (entity.complexity != null) metadataLines.push(`- **Complexity**: ${entity.complexity as number}`)

  sections.push(`## Entity Under Analysis
- **Name**: ${entity.name}
- **Kind**: ${entity.kind}
- **File**: ${entity.file_path}
- **Line**: ${entity.start_line ?? "unknown"}
${entity.signature ? `- **Signature**: ${entity.signature}` : ""}
${entity.doc ? `- **Documentation**: ${entity.doc as string}` : ""}
${metadataLines.length > 0 ? metadataLines.join("\n") : ""}
${entity.body ? `\n### Source Code\n\`\`\`\n${truncateBody(entity.body as string, maxBodyChars)}\n\`\`\`` : ""}`)

  // Section 2: Parent context (if entity is a method inside a class)
  if (options?.parentJustification) {
    const pj = options.parentJustification
    sections.push(`## Parent Context
This ${entity.kind} belongs to **${entity.parent ?? "unknown"}** (${pj.taxonomy}):
Purpose: ${pj.business_purpose}
Feature: ${pj.feature_tag}`)
  }

  // Section 3: Sibling context (other methods in the same class)
  if (options?.siblingNames && options.siblingNames.length > 0) {
    const siblings = options.siblingNames.slice(0, 8).join(", ")
    sections.push(`## Sibling Entities
Other members of the same parent: ${siblings}${options.siblingNames.length > 8 ? ` and ${options.siblingNames.length - 8} more` : ""}`)
  }

  // Section 4: Graph neighborhood
  if (graphContext.neighbors.length > 0) {
    const neighborList = graphContext.neighbors
      .slice(0, 15)
      .map((n) => {
        const location = n.file_path ? ` in ${n.file_path}` : ""
        return `  - [${n.direction}] ${n.name} (${n.kind})${location}`
      })
      .join("\n")
    sections.push(`## Graph Neighborhood (${graphContext.neighbors.length} connections)
${graphContext.subgraphSummary ?? ""}
${neighborList}
${graphContext.centrality != null ? `\nCentrality score: ${graphContext.centrality.toFixed(3)}` : ""}`)
  }

  // Section 5: Domain vocabulary
  if (ontology && ontology.terms.length > 0) {
    const vocabEntries = ontology.terms
      .slice(0, 20)
      .map((t) => {
        const def = ontology.ubiquitous_language[t.term]
        return def ? `  - **${t.term}**: ${def}` : `  - **${t.term}** (freq: ${t.frequency})`
      })
      .join("\n")
    sections.push(`## Domain Vocabulary (Ubiquitous Language)
${vocabEntries}`)
  }

  // Section 6: Dependency context (callees + callers)
  const nameMap = options?.entityNameMap
  const hasCallees = dependencyJustifications.length > 0
  const hasCallers = (options?.callerJustifications?.length ?? 0) > 0

  if (hasCallees || hasCallers) {
    const parts: string[] = []

    if (hasCallees) {
      const calleeList = dependencyJustifications
        .slice(0, 8)
        .map((j) => {
          const displayName = nameMap?.get(j.entity_id) ?? j.entity_id
          return `  - **${displayName}** [${j.taxonomy}]: ${j.business_purpose}`
        })
        .join("\n")
      parts.push(`**Calls (what this entity depends on):**\n${calleeList}`)
    }

    if (hasCallers) {
      const callerList = options!.callerJustifications!
        .slice(0, 5)
        .map((j) => {
          const displayName = nameMap?.get(j.entity_id) ?? j.entity_id
          return `  - **${displayName}** [${j.taxonomy}]: ${j.business_purpose}`
        })
        .join("\n")
      parts.push(`**Called by (what depends on this entity):**\n${callerList}`)
    }

    sections.push(`## Dependency Context\n${parts.join("\n\n")}`)
  }

  // Section 7: Test assertions (if available)
  if (testContext && testContext.assertions.length > 0) {
    const assertions = testContext.assertions.slice(0, 10).join("\n  - ")
    sections.push(`## Test Assertions
Test files: ${testContext.testFiles.join(", ")}
Key assertions:
  - ${assertions}`)
  }

  // Final instruction
  sections.push(`## Instructions
Analyze this entity and classify it with a business justification.

Respond with a JSON object containing:
- "taxonomy": one of "VERTICAL" (domain-specific business logic), "HORIZONTAL" (cross-cutting shared infrastructure), or "UTILITY" (testing, types, tooling)
- "confidence": 0.0 to 1.0 (how certain you are)
- "businessPurpose": 1-2 sentence explanation of WHY this code exists from a business perspective
- "domainConcepts": array of domain terms this entity relates to
- "featureTag": a short snake_case tag grouping this entity into a feature area (e.g., "user_auth", "payment_processing", "order_management")
- "semanticTriples": array of { "subject", "predicate", "object" } triples that capture the entity's relationships (e.g., { "subject": "OrderService", "predicate": "validates", "object": "payment_amount" })
- "complianceTags": array of compliance/regulatory tags if applicable (e.g., ["PCI-DSS", "GDPR"])
- "architecturalPattern": one of "pure_domain", "pure_infrastructure", "adapter", "mixed", "unknown"

Focus on business value, not technical implementation details.`)

  return sections.join("\n\n")
}

/**
 * Build a justification prompt for a batch of entities (used in dynamic batching).
 * Each entity gets a compact representation with truncated code snippets.
 */
export function buildBatchJustificationPrompt(
  entities: Array<{
    entity: EntityDoc
    graphContext: GraphContext
    parentJustification?: JustificationDoc
    calleeJustifications?: JustificationDoc[]
  }>,
  ontology: DomainOntologyDoc | null,
  entityNameMap?: Map<string, string>
): string {
  const sections: string[] = []

  sections.push(`# Batch Analysis Request
Analyze the following ${entities.length} code entities. For EACH entity, provide a JSON object.

Respond with a JSON array of objects, one per entity, in the same order. Each object must contain:
- "entityId": the entity ID (provided below)
- "taxonomy": "VERTICAL" | "HORIZONTAL" | "UTILITY"
- "confidence": 0.0 to 1.0
- "businessPurpose": 1-2 sentence business justification (use specific action verbs)
- "domainConcepts": array of domain terms
- "featureTag": short snake_case feature area tag
- "semanticTriples": array of { "subject", "predicate", "object" }
- "complianceTags": array of compliance tags (or empty array)
- "architecturalPattern": one of "pure_domain", "pure_infrastructure", "adapter", "mixed", "unknown"`)

  // Project context (shared across batch)
  if (ontology && (ontology.project_name || ontology.project_description)) {
    const projectLines: string[] = []
    if (ontology.project_name) projectLines.push(`Project: ${ontology.project_name}`)
    if (ontology.project_description) projectLines.push(`Description: ${ontology.project_description}`)
    if (ontology.project_domain) projectLines.push(`Domain: ${ontology.project_domain}`)
    if (ontology.tech_stack && ontology.tech_stack.length > 0) projectLines.push(`Tech stack: ${ontology.tech_stack.join(", ")}`)
    sections.push(`## Project Context\n${projectLines.join("\n")}`)
  }

  // Domain vocabulary (shared across batch)
  if (ontology && ontology.terms.length > 0) {
    const vocabEntries = ontology.terms
      .slice(0, 15)
      .map((t) => {
        const def = ontology.ubiquitous_language[t.term]
        return def ? `  - **${t.term}**: ${def}` : `  - **${t.term}**`
      })
      .join("\n")
    sections.push(`## Domain Vocabulary
${vocabEntries}`)
  }

  // Each entity as a compact section
  for (let i = 0; i < entities.length; i++) {
    const { entity, graphContext, parentJustification, calleeJustifications } = entities[i]!
    const body = entity.body as string | undefined
    // Truncate body to ~10 lines for batch mode
    const truncatedBody = body
      ? body.split("\n").slice(0, 10).join("\n") + (body.split("\n").length > 10 ? "\n// ..." : "")
      : null

    let entitySection = `## Entity ${i + 1} (ID: ${entity.id})
- **Name**: ${entity.name}
- **Kind**: ${entity.kind}
- **File**: ${entity.file_path}
${entity.signature ? `- **Signature**: ${entity.signature}` : ""}
${entity.doc ? `- **Documentation**: ${entity.doc as string}` : ""}`

    if (truncatedBody) {
      entitySection += `\n\`\`\`\n${truncatedBody}\n\`\`\``
    }

    if (parentJustification) {
      entitySection += `\n- **Parent**: ${entity.parent ?? "unknown"} — ${parentJustification.business_purpose}`
    }

    if (graphContext.neighbors.length > 0) {
      const neighborSummary = graphContext.neighbors
        .slice(0, 5)
        .map((n) => `${n.name} (${n.kind}, ${n.direction})`)
        .join(", ")
      entitySection += `\n- **Connections**: ${neighborSummary}`
    }

    if (calleeJustifications && calleeJustifications.length > 0) {
      const depSummary = calleeJustifications
        .slice(0, 3)
        .map((j) => {
          const displayName = entityNameMap?.get(j.entity_id) ?? j.entity_id
          return `${displayName} [${j.taxonomy}]: ${j.business_purpose}`
        })
        .join("; ")
      entitySection += `\n- **Dependencies**: ${depSummary}`
    }

    sections.push(entitySection)
  }

  return sections.join("\n\n")
}

/** Truncate source body to avoid exceeding token limits. */
function truncateBody(body: string, maxChars = 3000): string {
  if (body.length <= maxChars) return body
  return body.slice(0, maxChars) + "\n// ... truncated"
}
