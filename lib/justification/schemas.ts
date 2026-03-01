/**
 * Phase 4: Zod v4 schemas for the Business Justification & Taxonomy layer.
 */

import { z } from "zod"

// ── Taxonomy ────────────────────────────────────────────────────

export const TaxonomySchema = z.enum(["VERTICAL", "HORIZONTAL", "UTILITY"])
export type Taxonomy = z.infer<typeof TaxonomySchema>

// ── Semantic Triple ─────────────────────────────────────────────

export const SemanticTripleSchema = z.object({
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
})
export type SemanticTriple = z.infer<typeof SemanticTripleSchema>

// ── Justification Result ────────────────────────────────────────

export const ArchitecturalPatternSchema = z.enum([
  "pure_domain",
  "pure_infrastructure",
  "adapter",
  "mixed",
  "unknown",
])
export type ArchitecturalPattern = z.infer<typeof ArchitecturalPatternSchema>

export const JustificationResultSchema = z.object({
  taxonomy: TaxonomySchema,
  confidence: z.number().min(0).max(1),
  businessPurpose: z.string(),
  domainConcepts: z.array(z.string()),
  featureTag: z.string(),
  semanticTriples: z.array(SemanticTripleSchema),
  complianceTags: z.array(z.string()),
  architecturalPattern: ArchitecturalPatternSchema,
  reasoning: z.string().describe("2-3 sentence chain-of-evidence explaining your classification choices"),
})
export type JustificationResult = z.infer<typeof JustificationResultSchema>

// ── Domain Ontology ─────────────────────────────────────────────

export const DomainOntologySchema = z.object({
  orgId: z.string(),
  repoId: z.string(),
  terms: z.array(
    z.object({
      term: z.string(),
      frequency: z.number(),
      relatedTerms: z.array(z.string()),
    })
  ),
  ubiquitousLanguage: z.record(z.string(), z.string()),
  /** L-25: Three-tier term classification */
  termTiers: z.object({
    domain: z.array(z.string()),
    architectural: z.array(z.string()),
    framework: z.array(z.string()),
  }).optional(),
  /** L-25: Domain concept → architectural entity name mapping */
  domainToArchitecture: z.record(z.string(), z.array(z.string())).optional(),
  generatedAt: z.string(),
})
export type DomainOntology = z.infer<typeof DomainOntologySchema>

// ── Drift Score ─────────────────────────────────────────────────

export const DriftCategorySchema = z.enum(["stable", "cosmetic", "refactor", "intent_drift"])
export type DriftCategory = z.infer<typeof DriftCategorySchema>

export const DriftScoreSchema = z.object({
  entityId: z.string(),
  astHashOld: z.string(),
  astHashNew: z.string(),
  embeddingSimilarity: z.number().min(0).max(1),
  category: DriftCategorySchema,
  detectedAt: z.string(),
})
export type DriftScore = z.infer<typeof DriftScoreSchema>

// ── Health Report ───────────────────────────────────────────────

export const HealthRiskSchema = z.object({
  riskType: z.string(),
  entityId: z.string().optional(),
  featureTag: z.string().optional(),
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  category: z.enum(["dead_code", "architecture", "quality", "complexity", "taxonomy"]).optional(),
  affectedCount: z.number().optional(),
  entities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    filePath: z.string(),
    detail: z.string().optional(),
  })).optional(),
})
export type HealthRisk = z.infer<typeof HealthRiskSchema>

export const HealthReportSchema = z.object({
  orgId: z.string(),
  repoId: z.string(),
  totalEntities: z.number(),
  justifiedEntities: z.number(),
  averageConfidence: z.number(),
  taxonomyBreakdown: z.object({
    VERTICAL: z.number(),
    HORIZONTAL: z.number(),
    UTILITY: z.number(),
  }),
  risks: z.array(HealthRiskSchema),
  generatedAt: z.string(),
})
export type HealthReport = z.infer<typeof HealthReportSchema>

// ── Model Route ─────────────────────────────────────────────────

export const ModelTierSchema = z.enum(["heuristic", "fast", "standard", "premium"])
export type ModelTier = z.infer<typeof ModelTierSchema>

export const ModelRouteSchema = z.object({
  tier: ModelTierSchema,
  model: z.string().optional(),
  reason: z.string(),
})
export type ModelRoute = z.infer<typeof ModelRouteSchema>

// ── Pipeline Types ──────────────────────────────────────────────

export const JustificationBatchSchema = z.object({
  orgId: z.string(),
  repoId: z.string(),
  entityIds: z.array(z.string()),
  level: z.number(),
})
export type JustificationBatch = z.infer<typeof JustificationBatchSchema>

export const GraphContextSchema = z.object({
  entityId: z.string(),
  neighbors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      direction: z.enum(["inbound", "outbound"]),
      file_path: z.string().optional(),
    })
  ),
  centrality: z.number().optional(),
  subgraphSummary: z.string().optional(),
  communityLabel: z.string().optional(),
})
export type GraphContext = z.infer<typeof GraphContextSchema>

// ── Batch Justification Result ──────────────────────────────────

export const BatchJustificationItemSchema = z.object({
  entityId: z.string(),
  taxonomy: TaxonomySchema,
  confidence: z.number().min(0).max(1),
  businessPurpose: z.string(),
  domainConcepts: z.array(z.string()),
  featureTag: z.string(),
  semanticTriples: z.array(SemanticTripleSchema),
  complianceTags: z.array(z.string()),
  architecturalPattern: ArchitecturalPatternSchema,
  reasoning: z.string().describe("2-3 sentence chain-of-evidence explaining your classification choices"),
})
export type BatchJustificationItem = z.infer<typeof BatchJustificationItemSchema>

// Wrapped in an object because OpenAI response_format requires top-level type: "object"
export const BatchJustificationResultSchema = z.object({
  results: z.array(BatchJustificationItemSchema),
})
export type BatchJustificationResult = z.infer<typeof BatchJustificationResultSchema>

// ── ADR (Architecture Decision Record) ──────────────────────────

export const ADRSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  repoId: z.string(),
  featureArea: z.string(),
  title: z.string(),
  context: z.string(),
  decision: z.string(),
  consequences: z.string(),
  generatedAt: z.string(),
})
export type ADR = z.infer<typeof ADRSchema>
