/**
 * Phase 4: Health Report Builder — generates a codebase health report
 * from justifications, identifying risks and quality issues.
 *
 * Expanded from 4 to 13 risk types using entities + edges for graph analysis.
 */

import type { JustificationDoc, FeatureAggregation, HealthReportDoc, EntityDoc, EdgeDoc } from "@/lib/ports/types"
import type { HealthRisk } from "./schemas"
import { detectDeadCode } from "./dead-code-detector"
import { scoreJustification } from "./quality-scorer"
import { randomUUID } from "node:crypto"

/**
 * Build a health report for a repository from its justifications.
 * Optionally accepts entities + edges for expanded graph-based risk detection.
 */
export function buildHealthReport(
  justifications: JustificationDoc[],
  features: FeatureAggregation[],
  orgId: string,
  repoId: string,
  entities?: EntityDoc[],
  edges?: EdgeDoc[]
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

  // ──────────────── Original 4 risks ────────────────

  // Risk 1: Low confidence justifications
  const lowConfidence = justifications.filter((j) => j.confidence < 0.5)
  if (lowConfidence.length > 0) {
    risks.push({
      riskType: "low_confidence",
      description: `${lowConfidence.length} entities have low classification confidence (<0.5). These may need manual review.`,
      severity: lowConfidence.length > justifications.length * 0.3 ? "high" : "medium",
      category: "quality",
      affectedCount: lowConfidence.length,
    })
  }

  // Risk 2: Untested VERTICAL entities
  const verticalEntities = justifications.filter((j) => j.taxonomy === "VERTICAL")
  const untestedVertical = verticalEntities.filter((j) => j.confidence < 0.6)
  if (untestedVertical.length > 0) {
    risks.push({
      riskType: "untested_vertical",
      description: `${untestedVertical.length} VERTICAL (business-critical) entities have low confidence, suggesting insufficient test coverage.`,
      severity: untestedVertical.length > 5 ? "high" : "medium",
      category: "quality",
      affectedCount: untestedVertical.length,
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
        category: "taxonomy",
        affectedCount: 1,
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
      category: "taxonomy",
      affectedCount: taxonomyBreakdown["UTILITY"] ?? 0,
    })
  }

  // ──────────────── New risks (require entities + edges) ────────────────

  if (entities && edges) {
    // Build entity lookup for enriching risk items
    const entityMap = new Map<string, EntityDoc>()
    for (const e of entities) {
      entityMap.set(e.id, e)
    }

    // Build justification lookup by entity_id
    const justMap = new Map<string, JustificationDoc>()
    for (const j of justifications) {
      justMap.set(j.entity_id, j)
    }

    // Risk 5: Dead code
    const deadIds = detectDeadCode(entities, edges)
    if (deadIds.size > 0) {
      const deadEntities = Array.from(deadIds)
        .map((id) => entityMap.get(id))
        .filter((e): e is EntityDoc => !!e)
        .slice(0, 20)

      const pct = entities.length > 0 ? deadIds.size / entities.length : 0
      risks.push({
        riskType: "dead_code",
        description: `${deadIds.size} entities appear to be dead code (no inbound references, not exported, not entry points).`,
        severity: pct > 0.05 ? "high" : "medium",
        category: "dead_code",
        affectedCount: deadIds.size,
        entities: deadEntities.map((e) => ({
          id: e.id,
          name: e.name,
          filePath: e.file_path,
        })),
      })
    }

    // Risk 6: Architectural violations (mixed pattern)
    const mixedJustifications = justifications.filter((j) => j.architectural_pattern === "mixed")
    if (mixedJustifications.length > 0) {
      const hasVerticalMixed = mixedJustifications.some((j) => j.taxonomy === "VERTICAL")
      risks.push({
        riskType: "architectural_violation",
        description: `${mixedJustifications.length} entities mix domain and infrastructure concerns (architectural_pattern="mixed").`,
        severity: hasVerticalMixed ? "high" : "medium",
        category: "architecture",
        affectedCount: mixedJustifications.length,
        entities: mixedJustifications.slice(0, 20).map((j) => {
          const ent = entityMap.get(j.entity_id)
          return {
            id: j.entity_id,
            name: ent?.name ?? j.entity_id,
            filePath: ent?.file_path ?? "",
            detail: `${j.taxonomy} entity with mixed pattern`,
          }
        }),
      })
    }

    // Risk 7: Low quality justifications
    const lowQuality: Array<{ j: JustificationDoc; score: number; flags: string[] }> = []
    for (const j of justifications) {
      const qs = scoreJustification(j)
      if (qs.score < 0.5) {
        lowQuality.push({ j, score: qs.score, flags: qs.flags })
      }
    }
    if (lowQuality.length > 0) {
      const pct = justifications.length > 0 ? lowQuality.length / justifications.length : 0
      risks.push({
        riskType: "low_quality_justification",
        description: `${lowQuality.length} justifications scored below 0.5 quality — may contain generic phrases or lazy descriptions.`,
        severity: pct > 0.1 ? "high" : "medium",
        category: "quality",
        affectedCount: lowQuality.length,
        entities: lowQuality.slice(0, 20).map((lq) => {
          const ent = entityMap.get(lq.j.entity_id)
          return {
            id: lq.j.entity_id,
            name: ent?.name ?? lq.j.entity_id,
            filePath: ent?.file_path ?? "",
            detail: `Score: ${lq.score}, Flags: ${lq.flags.join(", ")}`,
          }
        }),
      })
    }

    // Risk 8: High fan-in (entities called by many)
    const inboundDegree = new Map<string, number>()
    for (const edge of edges) {
      if (edge.kind === "calls") {
        const toId = edge._to.split("/").pop()!
        inboundDegree.set(toId, (inboundDegree.get(toId) ?? 0) + 1)
      }
    }
    const highFanIn = Array.from(inboundDegree.entries())
      .filter(([, count]) => count >= 10)
      .sort((a, b) => b[1] - a[1])
    if (highFanIn.length > 0) {
      const maxCallers = highFanIn[0]?.[1] ?? 0
      risks.push({
        riskType: "high_fan_in",
        description: `${highFanIn.length} entities have 10+ callers — changes to these are high-risk.`,
        severity: maxCallers >= 20 ? "high" : "medium",
        category: "complexity",
        affectedCount: highFanIn.length,
        entities: highFanIn.slice(0, 20).map(([id, count]) => {
          const ent = entityMap.get(id)
          return {
            id,
            name: ent?.name ?? id,
            filePath: ent?.file_path ?? "",
            detail: `${count} callers`,
          }
        }),
      })
    }

    // Risk 9: High fan-out (entities calling many others)
    const outboundDegree = new Map<string, number>()
    for (const edge of edges) {
      if (edge.kind === "calls") {
        const fromId = edge._from.split("/").pop()!
        outboundDegree.set(fromId, (outboundDegree.get(fromId) ?? 0) + 1)
      }
    }
    const highFanOut = Array.from(outboundDegree.entries())
      .filter(([, count]) => count >= 10)
      .sort((a, b) => b[1] - a[1])
    if (highFanOut.length > 0) {
      const maxCallees = highFanOut[0]?.[1] ?? 0
      risks.push({
        riskType: "high_fan_out",
        description: `${highFanOut.length} entities call 10+ other entities — "god functions" that do too much.`,
        severity: maxCallees >= 15 ? "high" : "medium",
        category: "complexity",
        affectedCount: highFanOut.length,
        entities: highFanOut.slice(0, 20).map(([id, count]) => {
          const ent = entityMap.get(id)
          return {
            id,
            name: ent?.name ?? id,
            filePath: ent?.file_path ?? "",
            detail: `Calls ${count} entities`,
          }
        }),
      })
    }

    // Risk 10: Circular dependencies (iterative DFS cycle detection)
    const cycles = detectCycles(edges, 10)
    if (cycles.length > 0) {
      risks.push({
        riskType: "circular_dependency",
        description: `${cycles.length} circular dependency cycle(s) detected in the call/import graph.`,
        severity: "high",
        category: "architecture",
        affectedCount: cycles.length,
        entities: cycles.slice(0, 5).map((cycle, i) => ({
          id: cycle[0] ?? "",
          name: `Cycle ${i + 1}`,
          filePath: "",
          detail: cycle.map((id) => entityMap.get(id)?.name ?? id).join(" → "),
        })),
      })
    }

    // Risk 11: Taxonomy anomalies
    const anomalies: Array<{ id: string; reason: string }> = []
    // VERTICAL with 0 callers (unused business logic)
    for (const j of justifications) {
      if (j.taxonomy === "VERTICAL" && !inboundDegree.has(j.entity_id)) {
        anomalies.push({ id: j.entity_id, reason: "VERTICAL with 0 callers" })
      }
    }
    // HORIZONTAL called by exactly 1 feature
    for (const j of justifications) {
      if (j.taxonomy === "HORIZONTAL" && (inboundDegree.get(j.entity_id) ?? 0) === 1) {
        anomalies.push({ id: j.entity_id, reason: "HORIZONTAL called by 1 entity" })
      }
    }
    if (anomalies.length > 0) {
      risks.push({
        riskType: "taxonomy_anomaly",
        description: `${anomalies.length} entities have unexpected taxonomy/usage patterns.`,
        severity: "medium",
        category: "taxonomy",
        affectedCount: anomalies.length,
        entities: anomalies.slice(0, 20).map((a) => {
          const ent = entityMap.get(a.id)
          return {
            id: a.id,
            name: ent?.name ?? a.id,
            filePath: ent?.file_path ?? "",
            detail: a.reason,
          }
        }),
      })
    }

    // Risk 12: Confidence gap (features with low average confidence)
    const lowConfidenceFeatures = features.filter((f) => f.average_confidence < 0.6)
    if (lowConfidenceFeatures.length > 0) {
      const hasVeryLow = lowConfidenceFeatures.some((f) => f.average_confidence < 0.4)
      risks.push({
        riskType: "confidence_gap",
        description: `${lowConfidenceFeatures.length} features have average confidence below 0.6.`,
        severity: hasVeryLow ? "high" : "medium",
        category: "quality",
        affectedCount: lowConfidenceFeatures.length,
        entities: lowConfidenceFeatures.slice(0, 20).map((f) => ({
          id: f.id,
          name: f.feature_tag,
          filePath: "",
          detail: `Avg confidence: ${(f.average_confidence * 100).toFixed(0)}% (${f.entity_count} entities)`,
        })),
      })
    }

    // Risk 13: Missing justifications
    const justifiedIds = new Set(justifications.map((j) => j.entity_id))
    const unjustified = entities.filter((e) =>
      !justifiedIds.has(e.id) &&
      e.kind !== "file" && e.kind !== "module" && e.kind !== "namespace" && e.kind !== "directory"
    )
    if (unjustified.length > 0) {
      const functionalEntities = entities.filter((e) =>
        e.kind !== "file" && e.kind !== "module" && e.kind !== "namespace" && e.kind !== "directory"
      )
      const pct = functionalEntities.length > 0 ? unjustified.length / functionalEntities.length : 0
      if (pct > 0.05) {
        risks.push({
          riskType: "missing_justification",
          description: `${unjustified.length} entities (${Math.round(pct * 100)}%) have no justification.`,
          severity: pct > 0.2 ? "high" : "medium",
          category: "taxonomy",
          affectedCount: unjustified.length,
          entities: unjustified.slice(0, 20).map((e) => ({
            id: e.id,
            name: e.name,
            filePath: e.file_path,
          })),
        })
      }
    }
  }

  return {
    id: randomUUID(),
    org_id: orgId,
    repo_id: repoId,
    total_entities: entities?.length ?? justifications.length,
    justified_entities: justifications.length,
    average_confidence: Math.round(averageConfidence * 1000) / 1000,
    taxonomy_breakdown: taxonomyBreakdown,
    risks,
    generated_at: new Date().toISOString(),
  }
}

/**
 * Iterative DFS cycle detection on calls+imports edges.
 * Returns up to `maxCycles` cycles found.
 */
function detectCycles(edges: EdgeDoc[], maxCycles: number): string[][] {
  // Build adjacency list
  const adj = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (edge.kind === "calls" || edge.kind === "imports") {
      const from = edge._from.split("/").pop()!
      const to = edge._to.split("/").pop()!
      if (!adj.has(from)) adj.set(from, new Set())
      adj.get(from)!.add(to)
    }
  }

  const cycles: string[][] = []
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const stack: string[] = []

  for (const node of Array.from(adj.keys())) {
    if (cycles.length >= maxCycles) break
    if (visited.has(node)) continue
    dfsIterative(node, adj, visited, inStack, stack, cycles, maxCycles)
  }

  return cycles
}

function dfsIterative(
  start: string,
  adj: Map<string, Set<string>>,
  visited: Set<string>,
  inStack: Set<string>,
  stack: string[],
  cycles: string[][],
  maxCycles: number
): void {
  const callStack: Array<{ node: string; neighbors: string[]; idx: number }> = []
  callStack.push({ node: start, neighbors: Array.from(adj.get(start) ?? []), idx: 0 })
  visited.add(start)
  inStack.add(start)
  stack.push(start)

  while (callStack.length > 0) {
    if (cycles.length >= maxCycles) return
    const frame = callStack[callStack.length - 1]!
    if (frame.idx >= frame.neighbors.length) {
      inStack.delete(frame.node)
      stack.pop()
      callStack.pop()
      continue
    }
    const neighbor = frame.neighbors[frame.idx]!
    frame.idx++

    if (inStack.has(neighbor)) {
      // Found a cycle
      const cycleStart = stack.indexOf(neighbor)
      if (cycleStart !== -1) {
        cycles.push([...stack.slice(cycleStart), neighbor])
      }
      continue
    }

    if (!visited.has(neighbor)) {
      visited.add(neighbor)
      inStack.add(neighbor)
      stack.push(neighbor)
      callStack.push({ node: neighbor, neighbors: Array.from(adj.get(neighbor) ?? []), idx: 0 })
    }
  }
}
