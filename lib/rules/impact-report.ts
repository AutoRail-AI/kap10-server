/**
 * Impact Report generation — summarizes blast radius of a rule.
 */

import type { ImpactReportDoc, AstGrepResult } from "@/lib/ports/types"

export function generateImpactReport(
  orgId: string,
  repoId: string,
  ruleId: string,
  findings: AstGrepResult[],
  totalFilesScanned: number
): ImpactReportDoc {
  const crypto = require("node:crypto") as typeof import("node:crypto")

  const fileViolationMap = new Map<string, number>()
  for (const f of findings) {
    fileViolationMap.set(f.file, (fileViolationMap.get(f.file) ?? 0) + 1)
  }

  const totalViolations = findings.length
  const violatedFiles = fileViolationMap.size

  // Estimate fix effort based on violation density
  let effort: "low" | "medium" | "high" = "low"
  if (totalViolations > 50 || violatedFiles > 20) effort = "high"
  else if (totalViolations > 10 || violatedFiles > 5) effort = "medium"

  return {
    id: crypto.randomUUID().slice(0, 16),
    org_id: orgId,
    repo_id: repoId,
    rule_id: ruleId,
    total_files_scanned: totalFilesScanned,
    total_violations: totalViolations,
    violations_by_severity: {
      error: findings.filter((f) => f.message?.includes("error")).length,
      warning: findings.filter((f) => !f.message?.includes("error")).length,
    },
    affected_files: Array.from(fileViolationMap.entries())
      .map(([file, violations]) => ({ file, violations }))
      .sort((a, b) => b.violations - a.violations)
      .slice(0, 50),
    estimated_fix_effort: effort,
    generated_at: new Date().toISOString(),
  }
}
