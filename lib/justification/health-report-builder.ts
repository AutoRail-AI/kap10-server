/**
 * Phase 4: Health Report Builder — generates a codebase health report
 * from justifications, identifying risks and quality issues.
 */

import type { JustificationDoc, FeatureAggregation, HealthReportDoc } from "@/lib/ports/types"
import type { HealthRisk } from "./schemas"
import { randomUUID } from "node:crypto"

/**
 * Build a health report for a repository from its justifications.
 */
export function buildHealthReport(
  justifications: JustificationDoc[],
  features: FeatureAggregation[],
  orgId: string,
  repoId: string
): HealthReportDoc {
  const risks: HealthRisk[] = []

  // Stat aggregation
  const taxonomyBreakdown: Record<string, number> = { VERTICAL: 0, HORIZONTAL: 0, UTILITY: 0 }
  let totalConfidence = 0

  for (const j of justifications) {
    taxonomyBreakdown[j.taxonomy] = (taxonomyBreakdown[j.taxonomy] ?? 0) + 1
    totalConfidence += j.confidence
  }

  const averageConfidence = justifications.length > 0
    ? totalConfidence / justifications.length
    : 0

  // Risk 1: Low confidence justifications
  const lowConfidence = justifications.filter((j) => j.confidence < 0.5)
  if (lowConfidence.length > 0) {
    risks.push({
      riskType: "low_confidence",
      description: `${lowConfidence.length} entities have low classification confidence (<0.5). These may need manual review.`,
      severity: lowConfidence.length > justifications.length * 0.3 ? "high" : "medium",
    })
  }

  // Risk 2: Untested VERTICAL entities
  const verticalEntities = justifications.filter((j) => j.taxonomy === "VERTICAL")
  // (We'd need test context here; for now flag if many VERTICAL have low confidence)
  const untestedVertical = verticalEntities.filter((j) => j.confidence < 0.6)
  if (untestedVertical.length > 0) {
    risks.push({
      riskType: "untested_vertical",
      description: `${untestedVertical.length} VERTICAL (business-critical) entities have low confidence, suggesting insufficient test coverage.`,
      severity: untestedVertical.length > 5 ? "high" : "medium",
    })
  }

  // Risk 3: Single-entity features (orphan features)
  const singleEntityFeatures = features.filter((f) => f.entity_count === 1)
  if (singleEntityFeatures.length > 0) {
    for (const f of singleEntityFeatures.slice(0, 5)) {
      risks.push({
        riskType: "single_entity_feature",
        featureTag: f.feature_tag,
        description: `Feature "${f.feature_tag}" has only 1 entity — may indicate incomplete implementation or misclassification.`,
        severity: "low",
      })
    }
  }

  // Risk 4: High UTILITY ratio
  const utilityRatio = justifications.length > 0
    ? (taxonomyBreakdown["UTILITY"] ?? 0) / justifications.length
    : 0
  if (utilityRatio > 0.7) {
    risks.push({
      riskType: "high_utility_ratio",
      description: `${Math.round(utilityRatio * 100)}% of entities classified as UTILITY. Consider if some are actually HORIZONTAL or VERTICAL.`,
      severity: "medium",
    })
  }

  return {
    id: randomUUID(),
    org_id: orgId,
    repo_id: repoId,
    total_entities: justifications.length,
    justified_entities: justifications.length,
    average_confidence: Math.round(averageConfidence * 1000) / 1000,
    taxonomy_breakdown: taxonomyBreakdown,
    risks,
    generated_at: new Date().toISOString(),
  }
}
