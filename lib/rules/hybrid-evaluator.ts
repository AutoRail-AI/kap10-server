/**
 * Hybrid Rule Evaluator — two-pass evaluation:
 * 1. Syntactic pass: Semgrep CLI for deterministic pattern matching
 * 2. Semantic pass: ArangoDB enrichment with Phase 4 justifications
 */

import type { Container } from "@/lib/di/container"
import type { PatternMatch } from "@/lib/ports/pattern-engine"
import type { RuleDoc } from "@/lib/ports/types"

export interface HybridViolation {
  ruleId: string
  ruleTitle: string
  file: string
  line: number
  message: string
  enforcement: string
  severity: "info" | "warning" | "error"
  fix?: string
  justification?: string
  businessContext?: string
}

export interface HybridEvaluationResult {
  violations: HybridViolation[]
  rulesEvaluated: number
  syntacticMatches: number
  semanticEnrichments: number
}

export async function evaluateRulesHybrid(
  container: Container,
  orgId: string,
  repoId: string,
  rules: RuleDoc[],
  code: string,
  filePath?: string
): Promise<HybridEvaluationResult> {
  const violations: HybridViolation[] = []
  let syntacticMatches = 0
  let semanticEnrichments = 0

  // Pass 1: Syntactic evaluation with Semgrep
  const rulesWithSemgrep = rules.filter((r) => r.semgrepRule)
  for (const rule of rulesWithSemgrep) {
    try {
      const matches = await container.patternEngine.matchRule(code, rule.semgrepRule!)
      syntacticMatches += matches.length

      for (const match of matches) {
        violations.push({
          ruleId: rule.id,
          ruleTitle: rule.title,
          file: match.file,
          line: match.line,
          message: match.message ?? rule.description,
          enforcement: rule.enforcement,
          severity: enforcementToSeverity(rule.enforcement),
          fix: match.fix ?? rule.astGrepFix,
        })
      }
    } catch {
      // Skip failing rules
    }
  }

  // Pass 2: Semantic enrichment using graph context
  if (filePath) {
    const entities = await container.graphStore.getEntitiesByFile(orgId, repoId, filePath)
    for (const violation of violations) {
      // Find closest entity to the violation line
      const closest = entities.find((e) => {
        const startLine = Number(e.start_line) || 0
        return Math.abs(startLine - violation.line) < 10
      })
      if (closest) {
        const justification = await container.graphStore.getJustification(orgId, closest.id)
        if (justification) {
          violation.justification = justification.business_purpose
          violation.businessContext = justification.feature_tag
          semanticEnrichments++
        }
      }
    }
  }

  return {
    violations,
    rulesEvaluated: rules.length,
    syntacticMatches,
    semanticEnrichments,
  }
}

function enforcementToSeverity(enforcement: string): "info" | "warning" | "error" {
  switch (enforcement) {
    case "block": return "error"
    case "warn": return "warning"
    default: return "info"
  }
}
