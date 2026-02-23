/**
 * Check Run builder — builds rich markdown summary and annotations for GitHub Checks API.
 */

import type {
  BlastRadiusSummary,
  ComplexityFinding,
  ContractFinding,
  DependencyFinding,
  EnvFinding,
  IdempotencyFinding,
  ImpactFinding,
  PatternFinding,
  ReviewCheckAnnotation,
  TestFinding,
  TrustBoundaryFinding,
} from "@/lib/ports/types"

const MAX_ANNOTATIONS = 50

export interface CheckRunOutput {
  title: string
  summary: string
  annotations: ReviewCheckAnnotation[]
  conclusion: "success" | "failure" | "neutral"
}

export function buildCheckRunOutput(
  patternFindings: PatternFinding[],
  impactFindings: ImpactFinding[],
  testFindings: TestFinding[],
  complexityFindings: ComplexityFinding[],
  dependencyFindings: DependencyFinding[],
  blastRadius?: BlastRadiusSummary[],
  trustBoundaryFindings: TrustBoundaryFinding[] = [],
  envFindings: EnvFinding[] = [],
  contractFindings: ContractFinding[] = [],
  idempotencyFindings: IdempotencyFinding[] = []
): CheckRunOutput {
  const allAnnotations: ReviewCheckAnnotation[] = []

  // Pattern findings → annotations
  for (const f of patternFindings) {
    allAnnotations.push({
      path: f.filePath,
      start_line: f.line,
      end_line: f.endLine ?? f.line,
      annotation_level: mapSeverity(f.severity),
      message: f.message,
      title: f.ruleTitle,
      raw_details: f.suggestion ?? "",
    })
  }

  // Impact findings → annotations (warning level)
  for (const f of impactFindings) {
    allAnnotations.push({
      path: f.filePath,
      start_line: f.line,
      end_line: f.line,
      annotation_level: "warning",
      message: `${f.entityName} has ${f.callerCount} callers. Changes may have wide impact.`,
      title: "High Impact Entity",
      raw_details: `Top callers: ${f.topCallers.map((c) => c.name).join(", ")}`,
    })
  }

  // Test findings → annotations (warning level)
  for (const f of testFindings) {
    allAnnotations.push({
      path: f.filePath,
      start_line: 1,
      end_line: 1,
      annotation_level: "warning",
      message: f.message,
      title: "Missing Test Companion",
      raw_details: `Expected: ${f.expectedTestPath}`,
    })
  }

  // Complexity findings → annotations (warning level)
  for (const f of complexityFindings) {
    allAnnotations.push({
      path: f.filePath,
      start_line: f.line,
      end_line: f.line,
      annotation_level: "warning",
      message: `Cyclomatic complexity ${f.complexity} exceeds threshold ${f.threshold}`,
      title: `High Complexity: ${f.entityName}`,
      raw_details: "",
    })
  }

  // Dependency findings → annotations (notice level)
  for (const f of dependencyFindings) {
    allAnnotations.push({
      path: f.filePath,
      start_line: f.line,
      end_line: f.line,
      annotation_level: "notice",
      message: f.message,
      title: "New Dependency",
      raw_details: "",
    })
  }

  // Trust boundary findings → annotations (failure level)
  for (const f of trustBoundaryFindings) {
    allAnnotations.push({
      path: f.filePath,
      start_line: f.line,
      end_line: f.line,
      annotation_level: "failure",
      message: f.message,
      title: "Trust Boundary Gap",
      raw_details: `Source: ${f.sourceEntity.name} → Sink: ${f.sinkEntity.name} (${f.pathLength} hops)`,
    })
  }

  // Env findings → annotations (warning level)
  for (const f of envFindings) {
    allAnnotations.push({
      path: f.filePath,
      start_line: f.line,
      end_line: f.line,
      annotation_level: "warning",
      message: f.message,
      title: `Missing Env Var: ${f.envVar}`,
      raw_details: "",
    })
  }

  // Contract findings → annotations (warning level)
  for (const f of contractFindings) {
    allAnnotations.push({
      path: f.filePath,
      start_line: f.line,
      end_line: f.line,
      annotation_level: "warning",
      message: f.message,
      title: `API Contract Risk: ${f.affectedRoute.name}`,
      raw_details: `Depth: ${f.depth}, Callers: ${f.callerCount}`,
    })
  }

  // Idempotency findings → annotations (warning level)
  for (const f of idempotencyFindings) {
    allAnnotations.push({
      path: f.filePath,
      start_line: f.line,
      end_line: f.line,
      annotation_level: "warning",
      message: f.message,
      title: "Idempotency Risk",
      raw_details: `Trigger: ${f.triggerEntity.name} → Mutation: ${f.mutationEntity.name}`,
    })
  }

  const blockers = allAnnotations.filter((a) => a.annotation_level === "failure").length
  const warnings = allAnnotations.filter((a) => a.annotation_level === "warning").length
  const total = allAnnotations.length

  const conclusion: "success" | "failure" | "neutral" =
    blockers > 0 ? "failure" : total > 0 ? "neutral" : "success"

  const title =
    total === 0
      ? "No findings — clean PR"
      : `${total} finding(s) (${blockers} blocker(s), ${warnings} warning(s))`

  // Build summary markdown
  let summary = buildSummaryMarkdown(
    patternFindings,
    impactFindings,
    testFindings,
    complexityFindings,
    dependencyFindings,
    trustBoundaryFindings,
    envFindings,
    contractFindings,
    idempotencyFindings
  )

  if (blastRadius && blastRadius.length > 0) {
    summary += "\n\n" + buildBlastRadiusSection(blastRadius)
  }

  return {
    title,
    summary,
    annotations: allAnnotations.slice(0, MAX_ANNOTATIONS),
    conclusion,
  }
}

function mapSeverity(severity: "info" | "warning" | "error"): "notice" | "warning" | "failure" {
  switch (severity) {
    case "error":
      return "failure"
    case "warning":
      return "warning"
    default:
      return "notice"
  }
}

function buildSummaryMarkdown(
  patterns: PatternFinding[],
  impacts: ImpactFinding[],
  tests: TestFinding[],
  complexities: ComplexityFinding[],
  dependencies: DependencyFinding[],
  trustBoundaries: TrustBoundaryFinding[] = [],
  envs: EnvFinding[] = [],
  contracts: ContractFinding[] = [],
  idempotencies: IdempotencyFinding[] = []
): string {
  const sections: string[] = []

  if (patterns.length > 0) {
    sections.push(
      `### Pattern Violations (${patterns.length})\n\n| Rule | File | Line | Severity |\n|---|---|---|---|\n${patterns
        .map((f) => `| ${f.ruleTitle} | \`${f.filePath}\` | ${f.line} | ${f.severity} |`)
        .join("\n")}`
    )
  }

  if (impacts.length > 0) {
    sections.push(
      `### High-Impact Changes (${impacts.length})\n\n| Entity | File | Callers |\n|---|---|---|\n${impacts
        .map((f) => `| \`${f.entityName}\` | \`${f.filePath}\` | ${f.callerCount} |`)
        .join("\n")}`
    )
  }

  if (tests.length > 0) {
    sections.push(
      `### Missing Tests (${tests.length})\n\n${tests
        .map((f) => `- \`${f.filePath}\` → expected at \`${f.expectedTestPath}\``)
        .join("\n")}`
    )
  }

  if (complexities.length > 0) {
    sections.push(
      `### Complexity Spikes (${complexities.length})\n\n${complexities
        .map(
          (f) =>
            `- \`${f.entityName}\` in \`${f.filePath}\`: complexity ${f.complexity} (threshold: ${f.threshold})`
        )
        .join("\n")}`
    )
  }

  if (dependencies.length > 0) {
    sections.push(
      `### New Dependencies (${dependencies.length})\n\n${dependencies
        .map((f) => `- \`${f.importPath}\` in \`${f.filePath}:${f.line}\``)
        .join("\n")}`
    )
  }

  if (trustBoundaries.length > 0) {
    sections.push(
      `### Trust Boundary Gaps (${trustBoundaries.length})\n\n| Source | Sink | Path | File |\n|---|---|---|---|\n${trustBoundaries
        .map((f) => `| \`${f.sourceEntity.name}\` | \`${f.sinkEntity.name}\` | ${f.pathLength} hops | \`${f.filePath}\` |`)
        .join("\n")}`
    )
  }

  if (envs.length > 0) {
    sections.push(
      `### Missing Env Vars (${envs.length})\n\n${envs
        .map((f) => `- \`${f.envVar}\` in \`${f.filePath}:${f.line}\``)
        .join("\n")}`
    )
  }

  if (contracts.length > 0) {
    sections.push(
      `### API Contract Risks (${contracts.length})\n\n| Changed Entity | Affected Route | Depth | Callers |\n|---|---|---|---|\n${contracts
        .map((f) => `| \`${f.changedEntity.name}\` | \`${f.affectedRoute.name}\` (${f.affectedRoute.kind}) | ${f.depth} | ${f.callerCount} |`)
        .join("\n")}`
    )
  }

  if (idempotencies.length > 0) {
    sections.push(
      `### Idempotency Risks (${idempotencies.length})\n\n${idempotencies
        .map((f) => `- \`${f.triggerEntity.name}\` → \`${f.mutationEntity.name}\` in \`${f.filePath}:${f.line}\``)
        .join("\n")}`
    )
  }

  if (sections.length === 0) return "No findings. Clean PR! ✓"
  return sections.join("\n\n---\n\n")
}

function buildBlastRadiusSection(blastRadius: BlastRadiusSummary[]): string {
  let section = `### Impact Radius\n\n| Changed Entity | Upstream Boundaries | Hops | Callers |\n|---|---|---|---|\n`

  for (const br of blastRadius) {
    const boundaries = br.upstreamBoundaries.map((b) => `\`${b.name}\` (${b.kind})`).join(", ")
    const hops = br.upstreamBoundaries.map((b) => b.depth).join(", ")
    section += `| \`${br.entity}\` | ${boundaries} | ${hops} | ${br.callerCount} |\n`
  }

  // Add collapsible details for each entity
  for (const br of blastRadius) {
    if (br.upstreamBoundaries.length > 0) {
      section += `\n<details>\n<summary>Propagation paths for <code>${br.entity}</code></summary>\n\n`
      for (const boundary of br.upstreamBoundaries) {
        section += `- ${boundary.path}\n`
      }
      section += `\n</details>\n`
    }
  }

  return section
}
