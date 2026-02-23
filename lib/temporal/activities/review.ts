/**
 * Review activities — fetchDiff, runChecks, postReview, checkAndPostNudge
 */

import { getContainer } from "@/lib/di/container"
import { buildBlastRadiusSummary } from "@/lib/review/blast-radius"
import { buildCheckRunOutput } from "@/lib/review/check-run-builder"
import { runComplexityCheck } from "@/lib/review/checks/complexity-check"
import { runContractCheck } from "@/lib/review/checks/contract-check"
import { runDependencyCheck } from "@/lib/review/checks/dependency-check"
import { runEnvCheck } from "@/lib/review/checks/env-check"
import { runIdempotencyCheck } from "@/lib/review/checks/idempotency-check"
import { runImpactCheck } from "@/lib/review/checks/impact-check"
import { runPatternCheck } from "@/lib/review/checks/pattern-check"
import { runTestCheck } from "@/lib/review/checks/test-check"
import { runTrustBoundaryCheck } from "@/lib/review/checks/trust-boundary-check"
import { buildReviewResult } from "@/lib/review/comment-builder"
import { analyzeDiff } from "@/lib/review/diff-analyzer"
import { evaluateSemanticLgtm } from "@/lib/review/semantic-lgtm"
import type {
  BlastRadiusSummary,
  ComplexityFinding,
  ContractFinding,
  DependencyFinding,
  EnvFinding,
  EntityDoc,
  IdempotencyFinding,
  ImpactFinding,
  PatternFinding,
  TestFinding,
  TrustBoundaryFinding,
} from "@/lib/ports/types"
import type { DiffFile } from "@/lib/review/diff-analyzer"

/**
 * Combined activity: fetch diff + run all checks in one step.
 * Keeps large entity/diff arrays inside the worker — only findings cross Temporal.
 */
export async function fetchDiffAndRunChecks(input: {
  orgId: string
  repoId: string
  owner: string
  repo: string
  baseSha: string
  headSha: string
  installationId: number
}): Promise<{
  hasChanges: boolean
  findings: {
    pattern: PatternFinding[]
    impact: ImpactFinding[]
    test: TestFinding[]
    complexity: ComplexityFinding[]
    dependency: DependencyFinding[]
    trustBoundary: TrustBoundaryFinding[]
    env: EnvFinding[]
    contract: ContractFinding[]
    idempotency: IdempotencyFinding[]
  }
  filePaths: string[]
}> {
  const container = getContainer()
  const token = await container.gitHost.getInstallationToken(input.installationId)
  const rawDiff = await container.gitHost.getDiff(input.owner, input.repo, input.baseSha, input.headSha)
  const result = await analyzeDiff(rawDiff, input.orgId, input.repoId, container.graphStore)

  if (result.files.length === 0) {
    return {
      hasChanges: false,
      findings: { pattern: [], impact: [], test: [], complexity: [], dependency: [], trustBoundary: [], env: [], contract: [], idempotency: [] },
      filePaths: [],
    }
  }

  let blastRadius: BlastRadiusSummary[] = []
  try {
    blastRadius = await buildBlastRadiusSummary(input.orgId, result.affectedEntities, container.graphStore)
  } catch (error: unknown) {
    console.error("[fetchDiffAndRunChecks] blast radius failed:", error instanceof Error ? error.message : String(error))
  }

  const config = await container.relationalStore.getRepoReviewConfig(input.orgId)
  const os = await import("node:os")
  const path = await import("node:path")
  const workspacePath = path.join(os.tmpdir(), "kap10-workspaces", input.orgId, input.repoId)

  const [pattern, impact, test, complexity, dependency, trustBoundary, env, contract, idempotency] = await Promise.all([
    runPatternCheck(input.orgId, input.repoId, result.files, workspacePath, container.graphStore, container.patternEngine, config),
    runImpactCheck(input.orgId, result.affectedEntities, container.graphStore, config),
    runTestCheck(result.files, workspacePath, config),
    runComplexityCheck(result.affectedEntities, config),
    runDependencyCheck(input.orgId, input.repoId, result.files, workspacePath, container.graphStore, config),
    runTrustBoundaryCheck(input.orgId, input.repoId, result.affectedEntities, container.graphStore, config).catch(() => [] as TrustBoundaryFinding[]),
    runEnvCheck(result.files as unknown as Array<{ path: string; hunks: Array<{ content: string; newStart: number }> }>, workspacePath, config).catch(() => [] as EnvFinding[]),
    runContractCheck(input.orgId, result.affectedEntities, blastRadius, config).catch(() => [] as ContractFinding[]),
    runIdempotencyCheck(input.orgId, input.repoId, result.affectedEntities, container.graphStore, config).catch(() => [] as IdempotencyFinding[]),
  ])

  return {
    hasChanges: true,
    findings: { pattern, impact, test, complexity, dependency, trustBoundary, env, contract, idempotency },
    filePaths: result.files.map((f) => f.filePath),
  }
}

/**
 * Self-sufficient post-review: re-fetches diff and entities from source
 * to build the review and post to GitHub. Only findings and metadata
 * come from the workflow.
 */
export async function postReviewSelfSufficient(input: {
  orgId: string
  repoId: string
  reviewId: string
  owner: string
  repo: string
  prNumber: number
  headSha: string
  baseSha: string
  installationId: number
  findings: {
    pattern: PatternFinding[]
    impact: ImpactFinding[]
    test: TestFinding[]
    complexity: ComplexityFinding[]
    dependency: DependencyFinding[]
    trustBoundary?: TrustBoundaryFinding[]
    env?: EnvFinding[]
    contract?: ContractFinding[]
    idempotency?: IdempotencyFinding[]
  }
}): Promise<void> {
  const container = getContainer()

  // Re-fetch diff + entities (PR-scoped, typically small)
  const rawDiff = await container.gitHost.getDiff(input.owner, input.repo, input.baseSha, input.headSha)
  const diffResult = await analyzeDiff(rawDiff, input.orgId, input.repoId, container.graphStore)

  let blastRadius: BlastRadiusSummary[] = []
  try {
    blastRadius = await buildBlastRadiusSummary(input.orgId, diffResult.affectedEntities, container.graphStore)
  } catch {
    // Non-critical
  }

  // Delegate to existing postReview logic
  await postReview({
    ...input,
    diffFiles: diffResult.files,
    affectedEntities: diffResult.affectedEntities,
    findings: input.findings,
    blastRadius,
  })
}

/** @deprecated Use fetchDiffAndRunChecks instead. */
export async function fetchDiff(input: {
  orgId: string
  repoId: string
  owner: string
  repo: string
  baseSha: string
  headSha: string
  installationId: number
}): Promise<{
  files: DiffFile[]
  affectedEntities: Array<EntityDoc & { changedLines: Array<{ start: number; end: number }> }>
  blastRadius: BlastRadiusSummary[]
}> {
  const container = getContainer()
  const token = await container.gitHost.getInstallationToken(input.installationId)

  // Fetch diff via git host
  const rawDiff = await container.gitHost.getDiff(input.owner, input.repo, input.baseSha, input.headSha)

  // Analyze diff and map to entities
  const result = await analyzeDiff(rawDiff, input.orgId, input.repoId, container.graphStore)

  // Build blast radius summary
  let blastRadius: BlastRadiusSummary[] = []
  try {
    blastRadius = await buildBlastRadiusSummary(
      input.orgId,
      result.affectedEntities,
      container.graphStore
    )
  } catch (error: unknown) {
    console.error("[fetchDiff] blast radius failed:", error instanceof Error ? error.message : String(error))
  }

  return {
    files: result.files,
    affectedEntities: result.affectedEntities,
    blastRadius,
  }
}

export async function runChecks(input: {
  orgId: string
  repoId: string
  diffFiles: DiffFile[]
  affectedEntities: Array<EntityDoc & { changedLines: Array<{ start: number; end: number }> }>
  installationId: number
  blastRadius?: BlastRadiusSummary[]
}): Promise<{
  pattern: PatternFinding[]
  impact: ImpactFinding[]
  test: TestFinding[]
  complexity: ComplexityFinding[]
  dependency: DependencyFinding[]
  trustBoundary: TrustBoundaryFinding[]
  env: EnvFinding[]
  contract: ContractFinding[]
  idempotency: IdempotencyFinding[]
}> {
  const container = getContainer()
  const config = await container.relationalStore.getRepoReviewConfig(input.orgId)

  const os = await import("node:os")
  const path = await import("node:path")
  const workspacePath = path.join(os.tmpdir(), "kap10-workspaces", input.orgId, input.repoId)

  // Run all checks in parallel
  const [pattern, impact, test, complexity, dependency, trustBoundary, env, contract, idempotency] = await Promise.all([
    runPatternCheck(input.orgId, input.repoId, input.diffFiles, workspacePath, container.graphStore, container.patternEngine, config),
    runImpactCheck(input.orgId, input.affectedEntities, container.graphStore, config),
    runTestCheck(input.diffFiles, workspacePath, config),
    runComplexityCheck(input.affectedEntities, config),
    runDependencyCheck(input.orgId, input.repoId, input.diffFiles, workspacePath, container.graphStore, config),
    runTrustBoundaryCheck(input.orgId, input.repoId, input.affectedEntities, container.graphStore, config).catch(() => [] as TrustBoundaryFinding[]),
    runEnvCheck(input.diffFiles as unknown as Array<{ path: string; hunks: Array<{ content: string; newStart: number }> }>, workspacePath, config).catch(() => [] as EnvFinding[]),
    runContractCheck(input.orgId, input.affectedEntities, input.blastRadius ?? [], config).catch(() => [] as ContractFinding[]),
    runIdempotencyCheck(input.orgId, input.repoId, input.affectedEntities, container.graphStore, config).catch(() => [] as IdempotencyFinding[]),
  ])

  return { pattern, impact, test, complexity, dependency, trustBoundary, env, contract, idempotency }
}

export async function runChecksHeavy(input: {
  orgId: string
  repoId: string
  diffFiles: DiffFile[]
  workspacePath: string
}): Promise<PatternFinding[]> {
  const container = getContainer()
  const config = await container.relationalStore.getRepoReviewConfig(input.orgId)
  return runPatternCheck(input.orgId, input.repoId, input.diffFiles, input.workspacePath, container.graphStore, container.patternEngine, config)
}

export async function postReview(input: {
  orgId: string
  repoId: string
  reviewId: string
  owner: string
  repo: string
  prNumber: number
  headSha: string
  installationId: number
  diffFiles: DiffFile[]
  affectedEntities: Array<EntityDoc & { changedLines: Array<{ start: number; end: number }> }>
  findings: {
    pattern: PatternFinding[]
    impact: ImpactFinding[]
    test: TestFinding[]
    complexity: ComplexityFinding[]
    dependency: DependencyFinding[]
    trustBoundary?: TrustBoundaryFinding[]
    env?: EnvFinding[]
    contract?: ContractFinding[]
    idempotency?: IdempotencyFinding[]
  }
  blastRadius: BlastRadiusSummary[]
}): Promise<void> {
  const container = getContainer()

  try {
    // Update review status to reviewing
    await container.relationalStore.updatePrReview(input.reviewId, { status: "reviewing" })

    // Get review config
    const config = await container.relationalStore.getRepoReviewConfig(input.repoId)

    // Evaluate semantic LGTM
    let semanticLgtm = undefined
    try {
      const lgtmResult = await evaluateSemanticLgtm(
        input.orgId,
        input.affectedEntities,
        [],
        container.graphStore,
        config
      )
      if (lgtmResult.autoApprove) semanticLgtm = lgtmResult
    } catch {
      // Skip LGTM on error
    }

    // Build review result
    const reviewResult = buildReviewResult(
      input.findings.pattern,
      input.findings.impact,
      input.findings.test,
      input.findings.complexity,
      input.findings.dependency,
      config,
      semanticLgtm,
      input.findings.trustBoundary ?? [],
      input.findings.env ?? [],
      input.findings.contract ?? [],
      input.findings.idempotency ?? []
    )

    // Build Check Run output
    const checkRunOutput = buildCheckRunOutput(
      input.findings.pattern,
      input.findings.impact,
      input.findings.test,
      input.findings.complexity,
      input.findings.dependency,
      input.blastRadius,
      input.findings.trustBoundary ?? [],
      input.findings.env ?? [],
      input.findings.contract ?? [],
      input.findings.idempotency ?? []
    )

    let githubCheckRunId: number | null = null
    let githubReviewId: number | null = null

    // Post Check Run
    try {
      const checkRun = await container.gitHost.createCheckRun(input.owner, input.repo, {
        name: "kap10 Architecture Review",
        headSha: input.headSha,
        status: "in_progress",
      })
      githubCheckRunId = checkRun.checkRunId

      await container.gitHost.updateCheckRun(input.owner, input.repo, checkRun.checkRunId, {
        status: "completed",
        conclusion: checkRunOutput.conclusion,
        output: {
          title: checkRunOutput.title,
          summary: checkRunOutput.summary,
          annotations: checkRunOutput.annotations,
        },
      })
    } catch (error: unknown) {
      console.error("[postReview] Check Run failed:", error instanceof Error ? error.message : String(error))
    }

    // Post inline review (only for blockers or when Check Runs are not available)
    if (reviewResult.comments.length > 0) {
      const blockerComments = reviewResult.comments.filter((c) => c.severity === "error")
      const commentsToPost = blockerComments.length > 0 ? blockerComments : reviewResult.comments

      try {
        const review = await container.gitHost.postReview(input.owner, input.repo, input.prNumber, {
          event: reviewResult.action,
          body: reviewResult.body,
          comments: commentsToPost.map((c) => ({
            path: c.path,
            line: c.line,
            body: c.body,
          })),
        })
        githubReviewId = review.reviewId
      } catch (error: unknown) {
        console.error("[postReview] GitHub review failed:", error instanceof Error ? error.message : String(error))
      }
    }

    // Store review comments in database
    for (const comment of reviewResult.comments) {
      await container.relationalStore.createPrReviewComment({
        reviewId: input.reviewId,
        filePath: comment.path,
        lineNumber: comment.line,
        checkType: comment.checkType,
        severity: comment.severity,
        message: comment.body,
        suggestion: null,
        semgrepRuleId: null,
        ruleTitle: null,
        githubCommentId: null,
        autoFix: null,
      })
    }

    // Update review record
    await container.relationalStore.updatePrReview(input.reviewId, {
      status: "completed",
      checksPassed: reviewResult.checksPassed,
      checksWarned: reviewResult.checksWarned,
      checksFailed: reviewResult.checksFailed,
      reviewBody: reviewResult.body,
      githubReviewId,
      githubCheckRunId,
      autoApproved: reviewResult.autoApproved,
      completedAt: new Date().toISOString(),
    })
  } catch (error: unknown) {
    await container.relationalStore.updatePrReview(input.reviewId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function checkAndPostNudge(input: {
  orgId: string
  repoId: string
  prNumber: number
  reviewId: string
  owner: string
  repo: string
  headSha: string
  installationId: number
}): Promise<{ action: string; reason?: string }> {
  const container = getContainer()

  // Check config
  const config = await container.relationalStore.getRepoReviewConfig(input.repoId)
  if (!config.nudgeEnabled) {
    return { action: "skipped", reason: "Nudge disabled in config" }
  }

  // Check review still has blockers
  const review = await container.relationalStore.getPrReview(input.reviewId)
  if (!review || review.status !== "completed" || review.checksFailed === 0) {
    return { action: "skipped", reason: "Review not blocking or already resolved" }
  }

  // Check if PR is still open and no new commits
  try {
    const pr = await container.gitHost.getPullRequest(input.owner, input.repo, input.prNumber)
    if (pr.state === "closed") {
      return { action: "skipped", reason: "PR already closed" }
    }
    if (pr.headSha && pr.headSha !== input.headSha) {
      return { action: "skipped", reason: "New commits pushed — re-review will handle" }
    }
  } catch {
    return { action: "skipped", reason: "Could not fetch PR status" }
  }

  // Get blocker comments for the nudge
  const comments = await container.relationalStore.listPrReviewComments(input.reviewId)
  const blockerComments = comments.filter((c) => c.severity === "error")

  if (blockerComments.length === 0) {
    return { action: "skipped", reason: "No blocker comments found" }
  }

  // Post nudge comment
  const nudgeBody = buildNudgeComment(input.prNumber, blockerComments)
  await container.gitHost.postIssueComment(input.owner, input.repo, input.prNumber, nudgeBody)

  return { action: "nudged" }
}

function buildNudgeComment(
  prNumber: number,
  blockerComments: Array<{ ruleTitle: string | null; filePath: string; lineNumber: number }>
): string {
  const blockerList = blockerComments
    .map((c) => `- **${c.ruleTitle ?? "Architecture Rule"}** at \`${c.filePath}:${c.lineNumber}\``)
    .join("\n")

  return `**Hey! This PR is still blocked by ${blockerComments.length} architecture rule(s).**

It looks like no changes have been pushed in 48 hours. Here's a quick recap:

${blockerList}

**Need help?** Open your IDE and ask your AI agent:
> *"Why did kap10 block PR #${prNumber}? Help me fix it."*

Your agent will fetch the full context via \`review_pr_status\` and guide you through the fix.

<sub>This is an automated follow-up from kap10.</sub>`
}
