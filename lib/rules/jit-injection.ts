/**
 * JIT Rule Injection — gets relevant rules via sub-graph traversal + relevance scoring.
 */

import type { Container } from "@/lib/di/container"
import type { RuleDoc } from "@/lib/ports/types"
import { resolveRules } from "./resolver"

export interface JitRuleResult {
  rules: RuleDoc[]
  contextEntities: number
  traversalDepth: number
}

export async function getRelevantRules(
  container: Container,
  orgId: string,
  repoId: string,
  entityId?: string,
  filePath?: string,
  depth = 2,
  topK = 10
): Promise<JitRuleResult> {
  // Start with resolved rules for the file path
  const baseRules = await resolveRules(container, {
    orgId,
    repoId,
    filePath,
  })

  if (!entityId) {
    return { rules: baseRules.slice(0, topK), contextEntities: 0, traversalDepth: 0 }
  }

  // Get sub-graph context for the entity
  const subgraph = await container.graphStore.getSubgraph(orgId, entityId, depth)
  const contextEntities = subgraph.entities.length

  // Score rules based on entity context
  const scored = baseRules.map((rule) => {
    let score = rule.priority ?? 50

    // Boost if rule matches entity kinds in the subgraph
    if (rule.entityKinds && rule.entityKinds.length > 0) {
      const matchingEntities = subgraph.entities.filter((e) =>
        rule.entityKinds!.includes(e.kind)
      )
      score += matchingEntities.length * 5
    }

    // Boost if rule matches file types in the subgraph
    if (rule.fileTypes && rule.fileTypes.length > 0 && filePath) {
      const ext = filePath.split(".").pop() ?? ""
      if (rule.fileTypes.some((ft) => ft === ext || ft === `.${ext}`)) {
        score += 20
      }
    }

    return { rule, score }
  })

  scored.sort((a, b) => b.score - a.score)

  return {
    rules: scored.slice(0, topK).map((s) => s.rule),
    contextEntities,
    traversalDepth: depth,
  }
}
