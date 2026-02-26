/**
 * Phase 4: Prompt Builder — constructs LLM prompts for entity justification
 * anchored in graph context, domain ontology, and proven dependency justifications.
 *
 * Uses entity-specific prompt templates for functions, classes, files, and interfaces
 * to maximize justification quality per entity kind.
 */

import type { DomainOntologyDoc, EntityDoc, JustificationDoc } from "@/lib/ports/types"
import { extractCommentSignals, formatCommentSignalsForPrompt } from "./comment-signals"
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
  /** Heuristic hint from static analysis — passed as context to LLM, not used to skip */
  heuristicHint?: { taxonomy: string; featureTag: string; reason: string }
  /** Whether this entity has zero inbound references (potential dead code) */
  isDeadCode?: boolean
}

// ── Entity-Specific Section Builders ──────────────────────────────────────────

interface FunctionSectionOptions extends PromptBuilderOptions {
  /** Map of entity ID → business purpose for inline callee/caller context */
  depJustificationMap?: Map<string, string>
}

function buildFunctionSection(
  entity: EntityDoc,
  graphContext: GraphContext,
  maxBodyChars: number,
  options?: FunctionSectionOptions
): string {
  const lines: string[] = []
  lines.push(`## Function Under Analysis`)
  lines.push(`- **Name**: ${entity.name}`)
  lines.push(`- **Kind**: ${entity.kind}`)
  lines.push(`- **File**: ${entity.file_path}`)
  lines.push(`- **Line**: ${entity.start_line ?? "unknown"}`)
  if (entity.signature) lines.push(`- **Signature**: ${entity.signature}`)
  if (entity.doc) lines.push(`- **Documentation**: ${entity.doc as string}`)

  // Function-specific metadata
  if (entity.is_async) lines.push(`- **Async**: yes (uses async/await — consider I/O boundaries and error propagation)`)
  if (entity.parameter_count != null) lines.push(`- **Parameters**: ${entity.parameter_count as number}`)
  if (entity.return_type) lines.push(`- **Returns**: ${entity.return_type as string}`)
  if (entity.complexity != null) {
    const c = entity.complexity as number
    lines.push(`- **Complexity**: ${c}${c >= 10 ? " (high — likely orchestrates multiple paths)" : c >= 5 ? " (moderate)" : ""}`)
  }

  // Call graph emphasis for functions
  const callers = graphContext.neighbors.filter(n => n.direction === "inbound")
  const callees = graphContext.neighbors.filter(n => n.direction === "outbound")

  if (callers.length > 0 || callees.length > 0) {
    const depMap = options?.depJustificationMap
    lines.push(`\n### Call Graph`)
    if (callees.length > 0) {
      const calleeList = callees.slice(0, 8).map(n => {
        const purpose = depMap?.get(n.id)
        const loc = n.file_path ? ` in ${n.file_path}` : ""
        return purpose
          ? `  - ${n.name} (${n.kind})${loc} — "${purpose}"`
          : `  - ${n.name} (${n.kind})${loc}`
      }).join("\n")
      lines.push(`**Calls (outbound dependencies):**\n${calleeList}`)
    }
    if (callers.length > 0) {
      const callerList = callers.slice(0, 5).map(n => {
        const purpose = depMap?.get(n.id)
        const loc = n.file_path ? ` in ${n.file_path}` : ""
        return purpose
          ? `  - ${n.name} (${n.kind})${loc} — "${purpose}"`
          : `  - ${n.name} (${n.kind})${loc}`
      }).join("\n")
      lines.push(`**Called by (inbound dependents):**\n${callerList}`)
    }
  }

  if (entity.body) {
    lines.push(`\n### Source Code\n\`\`\`\n${truncateBody(entity.body as string, maxBodyChars)}\n\`\`\``)
  }

  return lines.join("\n")
}

function buildClassSection(
  entity: EntityDoc,
  graphContext: GraphContext,
  maxBodyChars: number,
  options?: PromptBuilderOptions
): string {
  const lines: string[] = []
  lines.push(`## Class Under Analysis`)
  lines.push(`- **Name**: ${entity.name}`)
  lines.push(`- **Kind**: ${entity.kind}`)
  lines.push(`- **File**: ${entity.file_path}`)
  lines.push(`- **Line**: ${entity.start_line ?? "unknown"}`)
  if (entity.signature) lines.push(`- **Signature**: ${entity.signature}`)
  if (entity.doc) lines.push(`- **Documentation**: ${entity.doc as string}`)

  // Inheritance chain from graph edges
  const extendsNeighbors = graphContext.neighbors.filter(n => n.direction === "outbound" && n.kind === "class")
  const implementsNeighbors = graphContext.neighbors.filter(n => n.direction === "outbound" && n.kind === "interface")
  if (extendsNeighbors.length > 0) {
    lines.push(`- **Extends**: ${extendsNeighbors.map(n => n.name).join(", ")}`)
  }
  if (implementsNeighbors.length > 0) {
    lines.push(`- **Implements**: ${implementsNeighbors.map(n => n.name).join(", ")}`)
  }

  // Method inventory from siblings
  if (options?.siblingNames && options.siblingNames.length > 0) {
    // Siblings of a class are other top-level entities; for methods, use parentJustification
  }

  // State fields and method count from metadata
  if (entity.complexity != null) lines.push(`- **Complexity**: ${entity.complexity as number}`)

  // Show methods if available from neighbor graph (children)
  const methodNeighbors = graphContext.neighbors.filter(n =>
    n.direction === "inbound" && (n.kind === "method" || n.kind === "function")
  )
  if (methodNeighbors.length > 0) {
    const methodList = methodNeighbors.slice(0, 12).map(n => `  - ${n.name}`).join("\n")
    lines.push(`\n### Methods (${methodNeighbors.length} total)\n${methodList}${methodNeighbors.length > 12 ? `\n  - ...and ${methodNeighbors.length - 12} more` : ""}`)
  }

  if (entity.body) {
    lines.push(`\n### Source Code\n\`\`\`\n${truncateBody(entity.body as string, maxBodyChars)}\n\`\`\``)
  }

  return lines.join("\n")
}

function buildFileSection(
  entity: EntityDoc,
  graphContext: GraphContext,
  maxBodyChars: number,
  _options?: PromptBuilderOptions
): string {
  const lines: string[] = []
  lines.push(`## Module Under Analysis`)
  lines.push(`- **Name**: ${entity.name}`)
  lines.push(`- **Kind**: ${entity.kind}`)
  lines.push(`- **File**: ${entity.file_path}`)

  // Infer architectural layer from file path
  const archLayer = inferArchitecturalLayer(entity.file_path)
  if (archLayer) {
    lines.push(`- **Architectural Layer**: ${archLayer}`)
  }

  // Export surface area from outbound connections
  const exports = graphContext.neighbors.filter(n => n.direction === "outbound")
  const imports = graphContext.neighbors.filter(n => n.direction === "inbound")

  if (exports.length > 0) {
    const exportList = exports.slice(0, 10).map(n => `  - ${n.name} (${n.kind})`).join("\n")
    lines.push(`\n### Exports (${exports.length} entities)\n${exportList}${exports.length > 10 ? `\n  - ...and ${exports.length - 10} more` : ""}`)
  }

  if (imports.length > 0) {
    lines.push(`\n### Imported by: ${imports.slice(0, 5).map(n => n.name).join(", ")}${imports.length > 5 ? ` and ${imports.length - 5} more` : ""}`)
  }

  // Detect barrel/index file
  const isBarrel = entity.name === "index" || entity.file_path.endsWith("/index.ts") || entity.file_path.endsWith("/index.js")
  if (isBarrel) {
    lines.push(`\n**Note**: This is a barrel/index file — its purpose is typically re-exporting from siblings.`)
  }

  if (entity.body) {
    lines.push(`\n### Source Code\n\`\`\`\n${truncateBody(entity.body as string, maxBodyChars)}\n\`\`\``)
  }

  return lines.join("\n")
}

function buildInterfaceSection(
  entity: EntityDoc,
  graphContext: GraphContext,
  maxBodyChars: number,
  _options?: PromptBuilderOptions
): string {
  const lines: string[] = []
  lines.push(`## Interface Under Analysis`)
  lines.push(`- **Name**: ${entity.name}`)
  lines.push(`- **Kind**: ${entity.kind}`)
  lines.push(`- **File**: ${entity.file_path}`)
  lines.push(`- **Line**: ${entity.start_line ?? "unknown"}`)
  if (entity.signature) lines.push(`- **Signature**: ${entity.signature}`)
  if (entity.doc) lines.push(`- **Documentation**: ${entity.doc as string}`)

  // Implementors from inbound implements edges
  const implementors = graphContext.neighbors.filter(n =>
    n.direction === "inbound" && (n.kind === "class" || n.kind === "struct")
  )
  if (implementors.length > 0) {
    const implList = implementors.slice(0, 8).map(n => `  - ${n.name}${n.file_path ? ` in ${n.file_path}` : ""}`).join("\n")
    lines.push(`\n### Implementors (${implementors.length})\n${implList}`)
  }

  // Extended by
  const extenders = graphContext.neighbors.filter(n =>
    n.direction === "inbound" && n.kind === "interface"
  )
  if (extenders.length > 0) {
    lines.push(`\n### Extended by: ${extenders.map(n => n.name).join(", ")}`)
  }

  if (entity.body) {
    lines.push(`\n### Contract Definition\n\`\`\`\n${truncateBody(entity.body as string, maxBodyChars)}\n\`\`\``)
  }

  return lines.join("\n")
}

function buildGenericSection(
  entity: EntityDoc,
  graphContext: GraphContext,
  maxBodyChars: number,
  _options?: PromptBuilderOptions
): string {
  const metadataLines: string[] = []
  if (entity.is_async) metadataLines.push("- **Async**: yes")
  if (entity.parameter_count != null) metadataLines.push(`- **Parameters**: ${entity.parameter_count as number}`)
  if (entity.return_type) metadataLines.push(`- **Returns**: ${entity.return_type as string}`)
  if (entity.complexity != null) metadataLines.push(`- **Complexity**: ${entity.complexity as number}`)

  return `## Entity Under Analysis
- **Name**: ${entity.name}
- **Kind**: ${entity.kind}
- **File**: ${entity.file_path}
- **Line**: ${entity.start_line ?? "unknown"}
${entity.signature ? `- **Signature**: ${entity.signature}` : ""}
${entity.doc ? `- **Documentation**: ${entity.doc as string}` : ""}
${metadataLines.length > 0 ? metadataLines.join("\n") : ""}
${entity.body ? `\n### Source Code\n\`\`\`\n${truncateBody(entity.body as string, maxBodyChars)}\n\`\`\`` : ""}`
}

/** Infer architectural layer from file path patterns. */
function inferArchitecturalLayer(filePath: string): string | null {
  if (/\/adapters?\//i.test(filePath)) return "adapter"
  if (/\/ports?\//i.test(filePath)) return "port (interface)"
  if (/\/use-?cases?\//i.test(filePath)) return "domain (use case)"
  if (/\/domain\//i.test(filePath)) return "domain"
  if (/\/infrastructure\//i.test(filePath)) return "infrastructure"
  if (/\/controllers?\//i.test(filePath)) return "controller"
  if (/\/services?\//i.test(filePath)) return "service"
  if (/\/middleware\//i.test(filePath)) return "middleware"
  if (/\/utils?\//i.test(filePath) || /\/helpers?\//i.test(filePath)) return "utility"
  if (/\/components?\//i.test(filePath)) return "UI component"
  if (/\/hooks?\//i.test(filePath)) return "React hook"
  if (/\/api\//i.test(filePath)) return "API route"
  if (/\/lib\//i.test(filePath)) return "library"
  return null
}

/**
 * Build a justification prompt for a single entity.
 * Uses entity-specific templates for functions, classes, files, and interfaces.
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
  const maxBodyChars = options?.modelTier === "fast" ? 4000
    : options?.modelTier === "premium" ? 12000
    : 8000

  // Section 0: Project context (if available from ontology)
  if (ontology && (ontology.project_name || ontology.project_description)) {
    const projectLines: string[] = []
    if (ontology.project_name) projectLines.push(`Project: ${ontology.project_name}`)
    if (ontology.project_description) projectLines.push(`Description: ${ontology.project_description}`)
    if (ontology.project_domain) projectLines.push(`Domain: ${ontology.project_domain}`)
    if (ontology.tech_stack && ontology.tech_stack.length > 0) projectLines.push(`Tech stack: ${ontology.tech_stack.join(", ")}`)
    sections.push(`## Project Context\n${projectLines.join("\n")}`)
  }

  // Section 0.5: Preliminary analysis hints (from static analysis)
  if (options?.heuristicHint || options?.isDeadCode) {
    const hintLines: string[] = []
    if (options.heuristicHint) {
      hintLines.push(`Static analysis suggests this entity is **${options.heuristicHint.taxonomy}** in the **${options.heuristicHint.featureTag}** area because: ${options.heuristicHint.reason}.`)
    }
    if (options.isDeadCode) {
      hintLines.push(`This entity has zero inbound references and may be dead code.`)
    }
    hintLines.push(`Use these observations as starting points but override based on your source code analysis.`)
    sections.push(`## Preliminary Analysis (Static)\n${hintLines.join("\n")}`)
  }

  // Build a lookup map from entity ID → business purpose for inline call graph context
  const depJustificationMap = new Map<string, string>()
  for (const j of dependencyJustifications) {
    depJustificationMap.set(j.entity_id, j.business_purpose)
  }
  if (options?.callerJustifications) {
    for (const j of options.callerJustifications) {
      depJustificationMap.set(j.entity_id, j.business_purpose)
    }
  }

  // Section 1: Entity details — dispatched by kind
  const entitySection = (() => {
    switch (entity.kind) {
      case "function": case "method": case "decorator":
        return buildFunctionSection(entity, graphContext, maxBodyChars, { ...options, depJustificationMap })
      case "class": case "struct":
        return buildClassSection(entity, graphContext, maxBodyChars, options)
      case "file": case "module": case "namespace":
        return buildFileSection(entity, graphContext, maxBodyChars, options)
      case "interface":
        return buildInterfaceSection(entity, graphContext, maxBodyChars, options)
      default:
        return buildGenericSection(entity, graphContext, maxBodyChars, options)
    }
  })()
  sections.push(entitySection)

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

  // Section 4: Graph neighborhood (only for generic — others embed it in their section)
  if (entity.kind !== "function" && entity.kind !== "method" && entity.kind !== "decorator" &&
      entity.kind !== "class" && entity.kind !== "struct" &&
      entity.kind !== "file" && entity.kind !== "module" && entity.kind !== "namespace" &&
      entity.kind !== "interface") {
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

  // Section 8: Author notes (TODO/FIXME/DEPRECATED markers)
  const commentSignals = extractCommentSignals(entity.body as string | undefined)
  if (commentSignals) {
    sections.push(`## Author Notes\n${formatCommentSignalsForPrompt(commentSignals)}`)
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
- "reasoning": 2-3 sentence chain-of-evidence explaining WHY you chose this taxonomy, feature tag, and business purpose. Reference specific code patterns, naming conventions, or architectural signals that led to your decision.

Focus on business value, not technical implementation details.`)

  return sections.join("\n\n")
}

/**
 * Build a compact kind-specific hint line for batch prompts.
 */
function buildKindHint(
  entity: EntityDoc,
  graphContext: GraphContext
): string {
  const callers = graphContext.neighbors.filter(n => n.direction === "inbound")
  const callees = graphContext.neighbors.filter(n => n.direction === "outbound")

  switch (entity.kind) {
    case "function": case "method": case "decorator": {
      const parts: string[] = []
      if (entity.is_async) parts.push("async")
      parts.push(entity.kind)
      if (callees.length > 0) parts.push(`${callees.length} callees`)
      if (callers.length > 0) parts.push(`${callers.length} callers`)
      if (entity.return_type) parts.push(`returns ${entity.return_type as string}`)
      return `Kind hint: ${parts.join(", ")}`
    }
    case "class": case "struct": {
      const parts: string[] = []
      const methods = graphContext.neighbors.filter(n => n.kind === "method" || n.kind === "function")
      if (methods.length > 0) parts.push(`${methods.length} methods`)
      const exts = graphContext.neighbors.filter(n => n.direction === "outbound" && n.kind === "class")
      if (exts.length > 0) parts.push(`extends ${exts.map(n => n.name).join(", ")}`)
      const impls = graphContext.neighbors.filter(n => n.direction === "outbound" && n.kind === "interface")
      if (impls.length > 0) parts.push(`implements ${impls.map(n => n.name).join(", ")}`)
      return parts.length > 0 ? `Kind hint: ${entity.kind} with ${parts.join(", ")}` : `Kind hint: ${entity.kind}`
    }
    case "file": case "module": case "namespace": {
      const layer = inferArchitecturalLayer(entity.file_path)
      const exports = graphContext.neighbors.filter(n => n.direction === "outbound")
      const parts: string[] = [`${entity.kind} file`]
      if (exports.length > 0) parts.push(`${exports.length} exports`)
      if (layer) parts.push(`architectural layer: ${layer}`)
      return `Kind hint: ${parts.join(", ")}`
    }
    case "interface": {
      const impls = graphContext.neighbors.filter(n => n.direction === "inbound" && (n.kind === "class" || n.kind === "struct"))
      return impls.length > 0
        ? `Kind hint: interface with ${impls.length} implementors (${impls.slice(0, 3).map(n => n.name).join(", ")})`
        : `Kind hint: interface contract`
    }
    default:
      return `Kind hint: ${entity.kind}`
  }
}

/**
 * Build a justification prompt for a batch of entities (used in dynamic batching).
 * Each entity gets a compact representation with truncated code snippets
 * and kind-specific hint lines.
 */
export function buildBatchJustificationPrompt(
  entities: Array<{
    entity: EntityDoc
    graphContext: GraphContext
    parentJustification?: JustificationDoc
    calleeJustifications?: JustificationDoc[]
    heuristicHint?: { taxonomy: string; featureTag: string; reason: string }
    isDeadCode?: boolean
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
- "architecturalPattern": one of "pure_domain", "pure_infrastructure", "adapter", "mixed", "unknown"
- "reasoning": 2-3 sentence chain-of-evidence explaining WHY you chose this taxonomy, feature tag, and business purpose. Reference specific code patterns, naming conventions, or architectural signals.`)

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
    const { entity, graphContext, parentJustification, calleeJustifications, heuristicHint, isDeadCode } = entities[i]!
    const body = entity.body as string | undefined
    // Truncate body to ~30 lines for batch mode
    const truncatedBody = body
      ? body.split("\n").slice(0, 30).join("\n") + (body.split("\n").length > 30 ? "\n// ..." : "")
      : null

    let entitySection = `## Entity ${i + 1} (ID: ${entity.id})
- **Name**: ${entity.name}
- **Kind**: ${entity.kind}
- **File**: ${entity.file_path}
${entity.signature ? `- **Signature**: ${entity.signature}` : ""}
${entity.doc ? `- **Documentation**: ${entity.doc as string}` : ""}
- ${buildKindHint(entity, graphContext)}`

    if (heuristicHint) {
      entitySection += `\n- **Static hint**: ${heuristicHint.taxonomy} / ${heuristicHint.featureTag} (${heuristicHint.reason})`
    }
    if (isDeadCode) {
      entitySection += `\n- **Warning**: Zero inbound references — potential dead code`
    }

    const batchSignals = extractCommentSignals(body ?? null)
    if (batchSignals) {
      entitySection += `\n- **Author Notes**: ${formatCommentSignalsForPrompt(batchSignals)}`
    }

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
