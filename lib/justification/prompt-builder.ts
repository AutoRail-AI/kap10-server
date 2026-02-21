/**
 * Phase 4: Prompt Builder — constructs LLM prompts for entity justification
 * anchored in graph context, domain ontology, and proven dependency justifications.
 */

import type { EntityDoc, DomainOntologyDoc, JustificationDoc } from "@/lib/ports/types"
import type { GraphContext } from "./schemas"
import type { TestContext } from "./types"

/**
 * Build a justification prompt for a single entity.
 */
export function buildJustificationPrompt(
  entity: EntityDoc,
  graphContext: GraphContext,
  ontology: DomainOntologyDoc | null,
  dependencyJustifications: JustificationDoc[],
  testContext?: TestContext
): string {
  const sections: string[] = []

  // Section 1: Entity details
  sections.push(`## Entity Under Analysis
- **Name**: ${entity.name}
- **Kind**: ${entity.kind}
- **File**: ${entity.file_path}
- **Line**: ${entity.start_line ?? "unknown"}
${entity.signature ? `- **Signature**: ${entity.signature}` : ""}
${entity.body ? `\n### Source Code\n\`\`\`\n${truncateBody(entity.body as string)}\n\`\`\`` : ""}`)

  // Section 2: Graph neighborhood
  if (graphContext.neighbors.length > 0) {
    const neighborList = graphContext.neighbors
      .slice(0, 15)
      .map((n) => `  - [${n.direction}] ${n.name} (${n.kind})`)
      .join("\n")
    sections.push(`## Graph Neighborhood (${graphContext.neighbors.length} connections)
${graphContext.subgraphSummary ?? ""}
${neighborList}
${graphContext.centrality != null ? `\nCentrality score: ${graphContext.centrality.toFixed(3)}` : ""}`)
  }

  // Section 3: Domain vocabulary
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

  // Section 4: Proven dependency justifications (from lower levels)
  if (dependencyJustifications.length > 0) {
    const depList = dependencyJustifications
      .slice(0, 10)
      .map(
        (j) =>
          `  - **${j.entity_id}** [${j.taxonomy}] (confidence: ${j.confidence.toFixed(2)}): ${j.business_purpose}`
      )
      .join("\n")
    sections.push(`## Proven Dependency Justifications
These entities that this entity depends on have already been analyzed:
${depList}`)
  }

  // Section 5: Test assertions (if available)
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

Focus on business value, not technical implementation details.`)

  return sections.join("\n\n")
}

/** Truncate source body to avoid exceeding token limits. */
function truncateBody(body: string, maxChars = 2000): string {
  if (body.length <= maxChars) return body
  return body.slice(0, maxChars) + "\n// ... truncated"
}
