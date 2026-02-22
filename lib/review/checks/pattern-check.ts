/**
 * Pattern check — runs Semgrep rules against changed files,
 * filtering to only report violations on changed lines.
 */

import type { IGraphStore } from "@/lib/ports/graph-store"
import type { IPatternEngine } from "@/lib/ports/pattern-engine"
import type { PatternFinding, ReviewConfig } from "@/lib/ports/types"
import type { DiffFile } from "../diff-analyzer"
import { isLineInChangedRange } from "../diff-analyzer"

export async function runPatternCheck(
  orgId: string,
  repoId: string,
  diffFiles: DiffFile[],
  workspacePath: string,
  graphStore: IGraphStore,
  patternEngine: IPatternEngine,
  config: ReviewConfig
): Promise<PatternFinding[]> {
  if (!config.checksEnabled.pattern) return []

  try {
    // Fetch active rules with semgrepRule from graph store
    const rules = await graphStore.queryRules(orgId, {
      orgId,
      repoId,
      status: "active",
    })

    const rulesWithSemgrep = rules.filter((r) => r.semgrepRule)
    if (rulesWithSemgrep.length === 0) return []

    // Build temporary Semgrep config from rules
    const configYaml = rulesWithSemgrep
      .map((r) => r.semgrepRule)
      .join("\n---\n")

    // Run Semgrep via pattern engine
    const matches = await patternEngine.scanPatterns(workspacePath, configYaml)

    // Map to PatternFinding, filtering to only changed lines
    const findings: PatternFinding[] = []
    for (const match of matches) {
      const filePath = match.file.startsWith(workspacePath)
        ? match.file.slice(workspacePath.length + 1)
        : match.file

      // Only report if the violation is on a changed line
      if (!isLineInChangedRange(diffFiles, filePath, match.line)) continue

      // Skip ignored paths
      if (config.ignorePaths.some((p) => filePath.startsWith(p) || filePath.match(new RegExp(p)))) continue

      const rule = rulesWithSemgrep.find((r) => r.id === match.ruleId || r.name === match.ruleId)

      findings.push({
        ruleId: rule?.id ?? match.ruleId ?? "unknown",
        ruleTitle: rule?.title ?? match.ruleId ?? "Pattern violation",
        filePath,
        line: match.line,
        endLine: undefined,
        message: match.message ?? rule?.description ?? "Pattern violation detected",
        severity: rule?.enforcement === "block" ? "error" : rule?.enforcement === "warn" ? "warning" : "info",
        suggestion: rule?.astGrepFix ?? null,
        semgrepRuleId: rule?.name,
        autoFix: null,
      })
    }

    return findings
  } catch (error: unknown) {
    console.error(
      "[pattern-check] Semgrep scan failed, degrading gracefully:",
      error instanceof Error ? error.message : String(error)
    )
    return []
  }
}
