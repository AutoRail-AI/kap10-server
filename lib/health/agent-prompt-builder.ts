/**
 * Generates copy-pasteable prompts for AI coding agents.
 * Each prompt includes what the issue is, affected files, fix steps, and expected outcome.
 */

import { FIX_GUIDANCE as _FIX_GUIDANCE } from "./fix-guidance"

interface AgentPromptEntity {
  name: string
  filePath: string
  detail?: string
}

interface AgentPromptInput {
  riskType: string
  title: string
  entities: AgentPromptEntity[]
  howToFix: string
  affectedCount: number
}

const RISK_TASK_NAMES: Record<string, string> = {
  dead_code: "Remove Dead Code",
  low_confidence: "Improve Code Documentation",
  untested_vertical: "Add Tests for Business Logic",
  single_entity_feature: "Review Orphan Features",
  high_utility_ratio: "Reclassify Utility Entities",
  architectural_violation: "Separate Domain from Infrastructure",
  low_quality_justification: "Improve Code Naming and Documentation",
  high_fan_in: "Protect High Fan-In Hotspots",
  high_fan_out: "Refactor God Functions",
  circular_dependency: "Break Circular Dependencies",
  taxonomy_anomaly: "Fix Taxonomy Anomalies",
  confidence_gap: "Improve Feature Boundaries",
  missing_justification: "Add Documentation for Unjustified Entities",
}

const RISK_DESCRIPTIONS: Record<string, (count: number) => string> = {
  dead_code: (n) =>
    `The following ${n} functions/classes have zero inbound references and are not exported entry points. They appear to be unused dead code.`,
  low_confidence: (n) =>
    `The following ${n} entities have poor naming or missing documentation, making it difficult to determine their business purpose.`,
  untested_vertical: (n) =>
    `The following ${n} business-critical entities lack tests or clear documentation.`,
  single_entity_feature: (n) =>
    `The following ${n} features contain only a single entity, suggesting misclassification or incomplete implementation.`,
  high_utility_ratio: (n) =>
    `Over 70% of entities are classified as UTILITY. The following ${n} entities may be misclassified and should be reviewed.`,
  architectural_violation: (n) =>
    `The following ${n} entities mix domain logic with infrastructure concerns (database calls, HTTP requests, file I/O).`,
  low_quality_justification: (n) =>
    `The following ${n} entities have generic or low-quality documentation that doesn't explain their business purpose.`,
  high_fan_in: (n) =>
    `The following ${n} entities are called by 10+ other entities, making them high-risk change points.`,
  high_fan_out: (n) =>
    `The following ${n} entities call 10+ other entities, indicating they're doing too much.`,
  circular_dependency: (n) =>
    `The following ${n} circular dependency cycles were detected between modules.`,
  taxonomy_anomaly: (n) =>
    `The following ${n} entities have unexpected taxonomy/usage patterns that should be reviewed.`,
  confidence_gap: (n) =>
    `The following ${n} features have low classification confidence, suggesting unclear domain boundaries.`,
  missing_justification: (n) =>
    `The following ${n} entities have no business justification. They need documentation to be included in the knowledge graph.`,
}

const RISK_INSTRUCTIONS: Record<string, string[]> = {
  dead_code: [
    "For each entity, verify it's not used via reflection, dynamic imports, or external tools",
    "If confirmed unused, delete the entity and its associated imports",
    "Run tests to ensure nothing breaks",
    "Remove any orphaned imports that result from deletion",
  ],
  low_confidence: [
    "Add JSDoc/docstring comments explaining the business purpose of each entity",
    "Rename functions and classes to better express their intent",
    "Add parameter descriptions for complex function signatures",
  ],
  untested_vertical: [
    "Create unit test files for each untested entity",
    "Cover the primary business logic paths with assertions",
    "Add edge case tests for error handling and boundary conditions",
  ],
  single_entity_feature: [
    "Review each entity's feature_tag — it may belong to a larger feature group",
    "If the feature name is too specific, merge it with a related feature",
    "If the entity is truly standalone, ensure it has comprehensive documentation",
  ],
  high_utility_ratio: [
    "Review a sample of UTILITY entities for business logic patterns",
    "Reclassify entities that implement domain rules as VERTICAL",
    "Reclassify shared services used across features as HORIZONTAL",
  ],
  architectural_violation: [
    "Identify infrastructure calls (DB, HTTP, file I/O) in each entity",
    "Extract infrastructure code into separate adapter/service functions",
    "Keep the original entity focused on business logic only",
    "Use dependency injection to provide infrastructure dependencies",
  ],
  low_quality_justification: [
    "Review each entity's naming — rename vague functions to express business intent",
    "Add docstrings that explain WHY the entity exists, not just WHAT it does",
    "Replace generic terms with domain-specific vocabulary",
  ],
  high_fan_in: [
    "Add comprehensive test coverage for each high fan-in entity",
    "Create stable interfaces/contracts that callers depend on",
    "Consider splitting entities with multiple responsibilities",
    "Document the entity's contract clearly so callers know what to expect",
  ],
  high_fan_out: [
    "Identify the distinct responsibilities within each entity",
    "Extract each responsibility into a focused helper function",
    "Create a coordinator/orchestrator that delegates to the focused functions",
    "Ensure each extracted function has a single, clear purpose",
  ],
  circular_dependency: [
    "Map out the dependency cycle to understand which modules are involved",
    "Extract shared interfaces/types into a separate module that both sides depend on",
    "Use dependency injection to break direct references",
    "Consider restructuring module boundaries to eliminate the cycle",
  ],
  taxonomy_anomaly: [
    "Review VERTICAL entities with no callers — they may be unused business logic",
    "Review HORIZONTAL entities called by only one feature — they may be VERTICAL",
    "Update entity classifications based on actual usage patterns",
  ],
  confidence_gap: [
    "Review the feature's entities to ensure they share a clear business purpose",
    "Add documentation that clarifies the feature's domain boundaries",
    "Consider renaming the feature tag if it's too broad or ambiguous",
  ],
  missing_justification: [
    "Add JSDoc/docstring comments explaining the business purpose of each entity",
    "Ensure function names clearly describe their intent",
    "Re-run the justification pipeline after adding documentation",
  ],
}

const RISK_OUTCOMES: Record<string, (count: number) => string> = {
  dead_code: (n) =>
    `Reduced codebase complexity and maintenance burden. ~${n} fewer unused symbols.`,
  low_confidence: (n) =>
    `Improved classification accuracy for ~${n} entities, leading to better feature maps and AI-assisted analysis.`,
  untested_vertical: (n) =>
    `${n} business-critical entities protected by tests, reducing regression risk.`,
  single_entity_feature: (n) =>
    `Cleaner feature boundaries with ${n} fewer orphan features in the blueprint view.`,
  high_utility_ratio: (_n) =>
    `More accurate taxonomy with better distinction between business logic and utilities.`,
  architectural_violation: (n) =>
    `${n} entities with clean separation of concerns, improving testability and maintainability.`,
  low_quality_justification: (n) =>
    `Higher quality knowledge graph with ${n} improved entity descriptions.`,
  high_fan_in: (n) =>
    `${n} high-risk hotspots protected with tests and stable interfaces.`,
  high_fan_out: (n) =>
    `${n} god functions refactored into focused, testable units.`,
  circular_dependency: (n) =>
    `${n} dependency cycles broken, enabling independent module testing and deployment.`,
  taxonomy_anomaly: (n) =>
    `Corrected taxonomy for ${n} entities, improving knowledge graph accuracy.`,
  confidence_gap: (n) =>
    `Improved classification confidence across ${n} features.`,
  missing_justification: (n) =>
    `${n} entities added to the knowledge graph, eliminating blind spots.`,
}

export function buildAgentPrompt(input: AgentPromptInput): string {
  const taskName =
    RISK_TASK_NAMES[input.riskType] ?? input.title
  const description =
    RISK_DESCRIPTIONS[input.riskType]?.(input.affectedCount) ??
    `The following ${input.affectedCount} entities need attention.`
  const instructions =
    RISK_INSTRUCTIONS[input.riskType] ?? [input.howToFix]
  const outcome =
    RISK_OUTCOMES[input.riskType]?.(input.affectedCount) ??
    `Improved code quality for ${input.affectedCount} entities.`

  const entityList = input.entities
    .slice(0, 25)
    .map((e) => {
      const loc = e.detail ? `:${e.detail}` : ""
      return `- \`${e.name}\` in ${e.filePath}${loc}`
    })
    .join("\n")

  const moreNote =
    input.entities.length > 25
      ? `\n- ...and ${input.entities.length - 25} more (see full list in the Issues view)\n`
      : ""

  const instructionsList = instructions
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n")

  return `## Task: ${taskName}

${description}

### Affected entities:
${entityList}${moreNote}

### Instructions:
${instructionsList}

### Expected outcome:
${outcome}`
}
