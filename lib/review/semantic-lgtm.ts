/**
 * Semantic LGTM — low-risk auto-approval evaluator using Phase 4 taxonomy.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"
import type { EntityDoc, ReviewConfig } from "@/lib/ports/types"
import type { ReviewComment } from "./comment-builder"

const DEFAULT_HORIZONTAL_AREAS = new Set(["utility", "infrastructure", "config", "docs", "test", "ci"])

export interface SemanticLgtmResult {
  autoApprove: boolean
  reason: string
}

export async function evaluateSemanticLgtm(
  orgId: string,
  affectedEntities: EntityDoc[],
  comments: ReviewComment[],
  graphStore: IGraphStore,
  config: ReviewConfig
): Promise<SemanticLgtmResult> {
  if (!config.semanticLgtmEnabled) {
    return { autoApprove: false, reason: "Semantic LGTM disabled in config" }
  }

  // Gate 1: No blockers
  if (comments.some((c) => c.severity === "error")) {
    return { autoApprove: false, reason: "Blocking violations found" }
  }

  const horizontalAreas = new Set(
    config.horizontalAreas.length > 0 ? config.horizontalAreas : DEFAULT_HORIZONTAL_AREAS
  )
  const callerThreshold = config.lowRiskCallerThreshold

  // Gate 2: All entities are low-risk
  for (const entity of affectedEntities) {
    const justification = await graphStore.getJustification(orgId, entity.id)

    if (!justification) {
      return { autoApprove: false, reason: `Entity ${entity.name} has no justification (unknown risk)` }
    }

    if (justification.taxonomy === "VERTICAL") {
      return { autoApprove: false, reason: `Entity ${entity.name} is in a VERTICAL feature area` }
    }

    if (!horizontalAreas.has(justification.feature_tag)) {
      return {
        autoApprove: false,
        reason: `Entity ${entity.name} is in non-horizontal area: ${justification.feature_tag}`,
      }
    }
  }

  // Gate 3: Low impact radius
  for (const entity of affectedEntities) {
    const callers = await graphStore.getCallersOf(orgId, entity.id)
    if (callers.length > callerThreshold) {
      return {
        autoApprove: false,
        reason: `${entity.name} has ${callers.length} callers (exceeds threshold ${callerThreshold})`,
      }
    }
  }

  return {
    autoApprove: true,
    reason: "All changed entities are horizontal/utility with low business value and low impact radius",
  }
}
