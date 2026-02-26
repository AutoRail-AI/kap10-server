/**
 * Phase 4: TypeScript interfaces for the Business Justification & Taxonomy layer.
 */

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import type {
  DriftCategory,
  GraphContext,
  HealthRisk,
  ModelTier,
  SemanticTriple,
  Taxonomy,
} from "./schemas"

// ── Justification Document (stored in ArangoDB) ─────────────────

export interface JustificationDoc {
  id: string
  org_id: string
  repo_id: string
  entity_id: string
  taxonomy: Taxonomy
  confidence: number
  business_purpose: string
  domain_concepts: string[]
  feature_tag: string
  semantic_triples: SemanticTriple[]
  compliance_tags: string[]
  architectural_pattern?: string
  model_tier: ModelTier
  model_used?: string
  valid_from: string
  valid_to: string | null
  created_at: string
}

// ── Feature Aggregation (stored in ArangoDB) ────────────────────

export interface FeatureAggregation {
  id: string
  org_id: string
  repo_id: string
  feature_tag: string
  entity_count: number
  entry_points: string[]
  hot_paths: string[][]
  taxonomy_breakdown: Record<Taxonomy, number>
  average_confidence: number
  created_at: string
}

// ── Health Report Document ──────────────────────────────────────

export interface HealthReportDoc {
  id: string
  org_id: string
  repo_id: string
  total_entities: number
  justified_entities: number
  average_confidence: number
  taxonomy_breakdown: Record<Taxonomy, number>
  risks: HealthRisk[]
  generated_at: string
}

// ── Domain Ontology Document ────────────────────────────────────

export interface DomainOntologyDoc {
  id: string
  org_id: string
  repo_id: string
  terms: Array<{
    term: string
    frequency: number
    relatedTerms: string[]
  }>
  ubiquitous_language: Record<string, string>
  project_name?: string
  project_description?: string
  project_domain?: string
  tech_stack?: string[]
  generated_at: string
}

// ── Drift Score Document ────────────────────────────────────────

export interface DriftScoreDoc {
  id: string
  org_id: string
  repo_id: string
  entity_id: string
  ast_hash_old: string
  ast_hash_new: string
  embedding_similarity: number
  category: DriftCategory
  detected_at: string
}

// ── ADR Document ────────────────────────────────────────────────

export interface ADRDoc {
  id: string
  org_id: string
  repo_id: string
  feature_area: string
  title: string
  context: string
  decision: string
  consequences: string
  generated_at: string
}

// ── Pipeline Internal Types ─────────────────────────────────────

export interface JustificationPipelineInput {
  orgId: string
  repoId: string
}

export interface EntityWithContext {
  entity: EntityDoc
  graphContext: GraphContext
  testContext?: TestContext
  dependencyJustifications: JustificationDoc[]
}

export interface TestContext {
  testFiles: string[]
  assertions: string[]
}

export interface HeuristicResult {
  taxonomy: Taxonomy
  confidence: number
  businessPurpose: string
  featureTag: string
  reason: string
}

export interface SubgraphResult {
  entities: EntityDoc[]
  edges: EdgeDoc[]
}
