/**
 * Comment builder — generates markdown review comments from all check findings.
 * Determines review action (APPROVE, REQUEST_CHANGES, COMMENT).
 */

import type {
  ComplexityFinding,
  DependencyFinding,
  ImpactFinding,
  PatternFinding,
  ReviewConfig,
  TestFinding,
} from "@/lib/ports/types"

export interface ReviewComment {
  path: string
  line: number
  body: string
  checkType: "pattern" | "impact" | "test" | "complexity" | "dependency"
  severity: "info" | "warning" | "error"
}

export interface ReviewResult {
  action: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
  body: string
  comments: ReviewComment[]
  checksPassed: number
  checksWarned: number
  checksFailed: number
  autoApproved: boolean
}

const MAX_INLINE_COMMENTS = 50

export function buildReviewResult(
  patternFindings: PatternFinding[],
  impactFindings: ImpactFinding[],
  testFindings: TestFinding[],
  complexityFindings: ComplexityFinding[],
  dependencyFindings: DependencyFinding[],
  config: ReviewConfig,
  semanticLgtm?: { autoApprove: boolean; reason: string }
): ReviewResult {
  const comments: ReviewComment[] = []

  // Pattern findings
  for (const f of patternFindings) {
    comments.push({
      path: f.filePath,
      line: f.line,
      body: formatPatternComment(f),
      checkType: "pattern",
      severity: f.severity,
    })
  }

  // Impact findings
  for (const f of impactFindings) {
    comments.push({
      path: f.filePath,
      line: f.line,
      body: formatImpactComment(f),
      checkType: "impact",
      severity: "warning",
    })
  }

  // Test findings
  for (const f of testFindings) {
    comments.push({
      path: f.filePath,
      line: 1,
      body: formatTestComment(f),
      checkType: "test",
      severity: "warning",
    })
  }

  // Complexity findings
  for (const f of complexityFindings) {
    comments.push({
      path: f.filePath,
      line: f.line,
      body: formatComplexityComment(f),
      checkType: "complexity",
      severity: "warning",
    })
  }

  // Dependency findings
  for (const f of dependencyFindings) {
    comments.push({
      path: f.filePath,
      line: f.line,
      body: formatDependencyComment(f),
      checkType: "dependency",
      severity: "info",
    })
  }

  // Count severities
  const checksFailed = comments.filter((c) => c.severity === "error").length
  const checksWarned = comments.filter((c) => c.severity === "warning").length
  const checksPassed = comments.filter((c) => c.severity === "info").length

  // Cap comments
  const cappedComments = comments.slice(0, MAX_INLINE_COMMENTS)

  // Determine action
  const action = determineReviewAction(comments, config, semanticLgtm)

  // Build body
  const body = buildReviewBody(
    checksPassed,
    checksWarned,
    checksFailed,
    comments.length,
    cappedComments.length < comments.length
  )

  return {
    action,
    body,
    comments: cappedComments,
    checksPassed,
    checksWarned,
    checksFailed,
    autoApproved: action === "APPROVE" && (semanticLgtm?.autoApprove ?? false),
  }
}

function determineReviewAction(
  comments: ReviewComment[],
  config: ReviewConfig,
  semanticLgtm?: { autoApprove: boolean; reason: string }
): "APPROVE" | "REQUEST_CHANGES" | "COMMENT" {
  if (comments.some((c) => c.severity === "error")) return "REQUEST_CHANGES"
  if (semanticLgtm?.autoApprove && config.semanticLgtmEnabled) return "APPROVE"
  if (comments.some((c) => c.severity === "warning")) return "COMMENT"
  if (config.autoApproveOnClean) return "APPROVE"
  return "COMMENT"
}

function buildReviewBody(
  passed: number,
  warned: number,
  failed: number,
  total: number,
  truncated: boolean
): string {
  if (total === 0) return "**kap10 Architecture Review** — No findings. Clean PR! ✓"

  const parts = []
  if (failed > 0) parts.push(`${failed} blocking`)
  if (warned > 0) parts.push(`${warned} warnings`)
  if (passed > 0) parts.push(`${passed} info`)

  let body = `**kap10 Architecture Review** — ${total} finding(s): ${parts.join(", ")}`
  if (truncated)
    body += `\n\n> Note: Showing first ${MAX_INLINE_COMMENTS} of ${total} findings. See the Checks tab for the full report.`
  return body
}

function formatPatternComment(f: PatternFinding): string {
  const icon = f.severity === "error" ? "⛔" : f.severity === "warning" ? "⚠️" : "ℹ️"
  const label = f.severity === "error" ? "Blocking" : f.severity === "warning" ? "Warning" : "Info"

  let body = `${icon} **${label}: ${f.ruleTitle}**\n\n${f.message}`

  if (f.autoFix && f.autoFix.confidence >= 0.9) {
    body += `\n\n\`\`\`suggestion\n${f.autoFix.fixedCode}\n\`\`\``
    body += `\n\n<sub>Auto-fix by ast-grep · Rule: \`${f.semgrepRuleId ?? f.ruleId}\`</sub>`
  } else if (f.suggestion) {
    body += `\n\n**Suggestion:** ${f.suggestion}`
  }

  return body
}

function formatImpactComment(f: ImpactFinding): string {
  const callerList = f.topCallers.map((c) => `\`${c.name}\` (\`${c.filePath}\`)`).join(", ")
  return `⚠️ **High Impact: ${f.entityName}** has **${f.callerCount} callers**\n\nTop callers: ${callerList}\n\nChanges to this entity may affect many upstream consumers. Consider adding integration tests.`
}

function formatTestComment(f: TestFinding): string {
  return `⚠️ **Missing Test Companion**\n\n${f.message}`
}

function formatComplexityComment(f: ComplexityFinding): string {
  return `⚠️ **High Complexity: ${f.entityName}** — cyclomatic complexity ${f.complexity} (threshold: ${f.threshold})\n\nConsider breaking this function into smaller, more focused functions.`
}

function formatDependencyComment(f: DependencyFinding): string {
  return `ℹ️ **New Dependency**\n\n${f.message}`
}

/**
 * Count suggestion comments for auto-fix (Click-to-Commit).
 * Returns the count of suggestion comments generated.
 */
export function countSuggestionComments(comments: ReviewComment[]): number {
  return comments.filter((c) => c.body.includes("```suggestion")).length
}
