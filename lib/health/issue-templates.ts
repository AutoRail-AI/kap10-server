/**
 * Deterministic reasoning & impact templates for each health risk type.
 * No LLM calls — just string interpolation with risk data.
 */

interface RiskData {
  riskType: string
  description: string
  severity: "low" | "medium" | "high"
  affectedCount?: number
  entities?: Array<{ id: string; name: string; filePath: string; detail?: string }>
  featureTag?: string
}

interface IssueTemplate {
  reasoning: (r: RiskData) => string
  impact: (r: RiskData) => string
}

export const ISSUE_TEMPLATES: Record<string, IssueTemplate> = {
  dead_code: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} entities have zero inbound references, are not exported entry points, and are not test helpers. ` +
      `They appear to be unused code that accumulated over time through feature changes or incomplete refactors.`,
    impact: (_r) =>
      `Dead code increases cognitive load for developers navigating the codebase, inflates bundle size, and creates false positives in search results. ` +
      `Over time it becomes harder to distinguish active code from abandoned code, slowing onboarding and increasing maintenance cost.`,
  },
  low_confidence: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} entities were classified with confidence below 0.5, meaning the AI could not reliably determine their business purpose. ` +
      `This usually indicates poor naming, missing documentation, or ambiguous function signatures.`,
    impact: (_r) =>
      `Low-confidence classifications reduce the accuracy of feature maps, blueprint views, and automated code reviews. ` +
      `AI agents working with this codebase will make less accurate suggestions for these entities.`,
  },
  untested_vertical: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} business-critical (VERTICAL) entities have low classification confidence, suggesting they lack tests or clear documentation. ` +
      `VERTICAL code implements core business logic — it should be the most well-documented and tested part of the codebase.`,
    impact: (_r) =>
      `Untested business logic is the highest-risk category for production incidents. ` +
      `Without tests, refactoring becomes dangerous, and regressions go undetected until they reach users.`,
  },
  single_entity_feature: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} features contain only a single entity. ` +
      `A feature with one entity usually indicates either misclassification (the entity belongs to a larger feature) or an overly specific feature tag.`,
    impact: (_r) =>
      `Orphan features fragment the blueprint view and create noise in feature-level analytics. ` +
      `They make it harder to understand the true feature boundaries of the application.`,
  },
  high_utility_ratio: {
    reasoning: (r) =>
      `Over 70% of entities are classified as UTILITY, suggesting the classifier lacks sufficient business context to distinguish domain logic from infrastructure. ` +
      `${r.description}`,
    impact: (_r) =>
      `When most code is labeled UTILITY, feature maps become meaningless — you lose the ability to trace business capabilities through the codebase. ` +
      `AI agents will treat business-critical code as generic utilities, reducing the quality of code reviews and suggestions.`,
  },
  architectural_violation: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} entities mix domain logic with infrastructure concerns (database calls, HTTP requests, file I/O) in the same function or class. ` +
      `This violates separation of concerns and creates tight coupling between business rules and implementation details.`,
    impact: (_r) =>
      `Mixed architecture patterns make unit testing expensive (requiring mocks for infrastructure), ` +
      `make it difficult to swap infrastructure (e.g., changing databases), and increase the blast radius of infrastructure changes.`,
  },
  low_quality_justification: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} entity justifications contain generic phrases, lazy phrasing, or use programming terms as domain concepts. ` +
      `This indicates the source code lacks clear naming and documentation for the AI to produce meaningful business descriptions.`,
    impact: (_r) =>
      `Low-quality justifications degrade the entire knowledge graph — downstream features like code reviews, impact analysis, and MCP queries ` +
      `all rely on accurate entity descriptions to provide value.`,
  },
  high_fan_in: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} entities are called by 10 or more other entities, making them high-risk change points. ` +
      `Any modification to these hotspots can break many dependents across the codebase.`,
    impact: (_r) =>
      `High fan-in entities are the most dangerous places to introduce bugs. A single change can cascade failures across the entire application. ` +
      `Without comprehensive test coverage, these become ticking time bombs during refactoring.`,
  },
  high_fan_out: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} entities call 10 or more other entities, indicating they're doing too much — orchestrating, transforming, and delegating all in one place. ` +
      `These "god functions" are difficult to understand, test, and maintain.`,
    impact: (_r) =>
      `God functions resist refactoring because changing anything requires understanding all their responsibilities at once. ` +
      `They accumulate bugs faster and are the most common source of merge conflicts in active codebases.`,
  },
  circular_dependency: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} circular dependency cycles were detected between modules. ` +
      `Circular dependencies mean modules cannot be understood, tested, or deployed independently.`,
    impact: (_r) =>
      `Circular dependencies create a cascading build problem — changing any module in the cycle forces rebuilding all of them. ` +
      `They prevent code splitting, make lazy loading impossible, and often cause subtle initialization-order bugs.`,
  },
  taxonomy_anomaly: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} entities have unexpected taxonomy/usage patterns: VERTICAL entities with no callers (unused business logic) ` +
      `or HORIZONTAL entities called by only one feature (potentially misclassified). ${r.description}`,
    impact: (_r) =>
      `Taxonomy anomalies indicate the knowledge graph doesn't accurately reflect the codebase structure. ` +
      `This reduces the reliability of feature maps, dependency analysis, and automated code review decisions.`,
  },
  confidence_gap: {
    reasoning: (r) =>
      `Features with low average classification confidence lack clear domain boundaries. ` +
      `${r.description}`,
    impact: (_r) =>
      `Low-confidence features produce unreliable blueprint views and weaken AI-assisted code review accuracy. ` +
      `Developers and AI agents cannot trust the feature boundaries for impact analysis or change planning.`,
  },
  missing_justification: {
    reasoning: (r) =>
      `${r.affectedCount ?? 0} entities have no business justification at all. ` +
      `They may have been added after the last pipeline run or failed during processing.`,
    impact: (_r) =>
      `Unjustified entities are invisible to feature maps, code reviews, and MCP queries. ` +
      `They represent blind spots in the knowledge graph that AI agents cannot reason about.`,
  },
}

/** Get reasoning text for a risk, with fallback */
export function getReasoning(risk: RiskData): string {
  const template = ISSUE_TEMPLATES[risk.riskType]
  if (template) return template.reasoning(risk)
  return risk.description
}

/** Get impact text for a risk, with fallback */
export function getImpact(risk: RiskData): string {
  const template = ISSUE_TEMPLATES[risk.riskType]
  if (template) return template.impact(risk)
  return "Ignoring this issue may degrade code quality and reduce the effectiveness of AI-assisted analysis."
}
