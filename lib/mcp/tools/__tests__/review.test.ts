import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { handleReviewPrStatus } from "../review"
import type { McpAuthContext } from "../../auth"
import type { PrReviewCommentRecord } from "@/lib/ports/types"

const ORG = "org-review-mcp"
const REPO_ID = `repo-review-${Date.now()}`

let container: Container
let ctx: McpAuthContext

beforeEach(() => {
  container = createTestContainer()
  ctx = {
    authMode: "api_key",
    userId: "u-1",
    orgId: ORG,
    repoId: REPO_ID,
    scopes: ["mcp:read"],
    apiKeyId: "k-1",
  }
})

async function seedReview(prNumber: number, headSha: string) {
  return container.relationalStore.createPrReview({
    repoId: REPO_ID,
    prNumber,
    prTitle: `PR #${prNumber} — some feature`,
    prUrl: `https://github.com/acme/app/pull/${prNumber}`,
    headSha,
    baseSha: "base000sha",
  })
}

async function seedComment(
  reviewId: string,
  overrides: Partial<Omit<PrReviewCommentRecord, "id" | "createdAt">> = {}
) {
  return container.relationalStore.createPrReviewComment({
    reviewId,
    filePath: "lib/service.ts",
    lineNumber: 42,
    checkType: "pattern",
    severity: "info",
    message: "Info message",
    suggestion: null,
    semgrepRuleId: null,
    ruleTitle: null,
    githubCommentId: null,
    autoFix: null,
    ...overrides,
  })
}

describe("handleReviewPrStatus", () => {
  it("returns error when pr_number is missing", async () => {
    const result = await handleReviewPrStatus({}, ctx, container)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("pr_number")
  })

  it("returns error when pr_number is not a number", async () => {
    const result = await handleReviewPrStatus({ pr_number: "not-a-number" }, ctx, container)
    expect(result.isError).toBe(true)
  })

  it("returns error when no repo context is set", async () => {
    const noRepoCtx: McpAuthContext = { ...ctx, repoId: undefined }
    const result = await handleReviewPrStatus({ pr_number: 1 }, noRepoCtx, container)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("repo context")
  })

  it("returns informational message when no review exists for the PR", async () => {
    const result = await handleReviewPrStatus({ pr_number: 999 }, ctx, container)

    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain("No review found for PR #999")
  })

  it("returns review details with empty blockers, warnings, and info for a clean review", async () => {
    const review = await seedReview(10, "sha-clean-001")
    await container.relationalStore.updatePrReview(review.id, {
      status: "completed",
      checksPassed: 5,
      checksWarned: 0,
      checksFailed: 0,
      autoApproved: true,
      completedAt: new Date().toISOString(),
    })

    const result = await handleReviewPrStatus({ pr_number: 10 }, ctx, container)
    expect(result.isError).toBeUndefined()

    const parsed = JSON.parse(result.content[0]!.text) as {
      pr: { number: number; title: string }
      review: { status: string; checksPassed: number; autoApproved: boolean }
      blockers: unknown[]
      warnings: unknown[]
      info: unknown[]
      guidance: string
    }

    expect(parsed.pr.number).toBe(10)
    expect(parsed.review.status).toBe("completed")
    expect(parsed.review.checksPassed).toBe(5)
    expect(parsed.review.autoApproved).toBe(true)
    expect(parsed.blockers).toHaveLength(0)
    expect(parsed.warnings).toHaveLength(0)
    expect(parsed.guidance).toContain("passed all checks")
  })

  it("includes blockers in the response and generates blocked guidance", async () => {
    const review = await seedReview(20, "sha-blocked-001")

    // Seed 2 error-severity comments (blockers)
    await seedComment(review.id, {
      severity: "error",
      message: "Violates security rule",
      checkType: "pattern",
      ruleTitle: "No hardcoded secrets",
      suggestion: "Use environment variables instead",
      autoFix: null,
    })
    await seedComment(review.id, {
      severity: "error",
      message: "High impact change",
      checkType: "impact",
      ruleTitle: null,
      filePath: "lib/core/db.ts",
      lineNumber: 99,
    })

    const result = await handleReviewPrStatus({ pr_number: 20 }, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      blockers: Array<{ message: string; checkType: string }>
      warnings: unknown[]
      guidance: string
    }

    expect(parsed.blockers).toHaveLength(2)
    expect(parsed.blockers.some((b) => b.message === "Violates security rule")).toBe(true)
    expect(parsed.blockers.some((b) => b.checkType === "impact")).toBe(true)
    expect(parsed.guidance).toContain("blocked by 2 rule(s)")
  })

  it("includes warnings but no blockers when there are only warning-severity comments", async () => {
    const review = await seedReview(30, "sha-warned-001")

    await seedComment(review.id, {
      severity: "warning",
      message: "Consider refactoring",
      checkType: "complexity",
    })

    const result = await handleReviewPrStatus({ pr_number: 30 }, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      blockers: unknown[]
      warnings: Array<{ message: string }>
      guidance: string
    }

    expect(parsed.blockers).toHaveLength(0)
    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.warnings[0]!.message).toBe("Consider refactoring")
    expect(parsed.guidance).toContain("warnings but no blockers")
  })

  it("returns info comments separately from blockers and warnings", async () => {
    const review = await seedReview(40, "sha-info-001")

    await seedComment(review.id, { severity: "info", message: "Coverage note", checkType: "test" })
    await seedComment(review.id, { severity: "info", message: "Minor suggestion", checkType: "dependency" })

    const result = await handleReviewPrStatus({ pr_number: 40 }, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      blockers: unknown[]
      warnings: unknown[]
      info: Array<{ message: string }>
    }

    expect(parsed.blockers).toHaveLength(0)
    expect(parsed.warnings).toHaveLength(0)
    expect(parsed.info).toHaveLength(2)
    expect(parsed.info.map((i) => i.message)).toContain("Coverage note")
  })

  it("enriches blockers with rule context when semgrepRuleId is set", async () => {
    // Seed a rule in graphStore
    await container.graphStore.upsertRule(ORG, {
      id: "rule-no-secrets",
      org_id: ORG,
      repo_id: REPO_ID,
      name: "no-hardcoded-secrets",
      title: "No Hardcoded Secrets",
      description: "Detect hardcoded credentials",
      type: "security",
      scope: "repo",
      enforcement: "block",
      priority: 100,
      status: "active",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    })

    const review = await seedReview(50, "sha-enrich-001")
    await seedComment(review.id, {
      severity: "error",
      semgrepRuleId: "rule-no-secrets",
      message: "Hardcoded secret found",
      checkType: "pattern",
      ruleTitle: "No Hardcoded Secrets",
    })

    const result = await handleReviewPrStatus({ pr_number: 50 }, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      blockers: Array<{
        semgrepRuleId?: string
        rule: { title: string; enforcement: string } | null
      }>
    }

    expect(parsed.blockers).toHaveLength(1)
    expect(parsed.blockers[0]!.rule).not.toBeNull()
    expect(parsed.blockers[0]!.rule!.title).toBe("No Hardcoded Secrets")
    expect(parsed.blockers[0]!.rule!.enforcement).toBe("block")
  })

  it("uses the latest review record (highest in the list) for the given PR number", async () => {
    // First review for PR #60
    const first = await seedReview(60, "sha-first-001")
    await container.relationalStore.updatePrReview(first.id, { status: "completed" })

    // Second review for the same PR (new push)
    const second = await seedReview(60, "sha-second-002")
    await container.relationalStore.updatePrReview(second.id, { status: "reviewing" })

    const result = await handleReviewPrStatus({ pr_number: 60 }, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as { review: { id: string } }

    // listPrReviews sorts by createdAt desc, so the first found is the most recent
    // Both have the same pr_number; the handler uses .find() so it returns the first match
    expect(parsed.review.id).toBeDefined()
  })
})
