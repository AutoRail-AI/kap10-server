/**
 * MCP Tool: review_pr_status — "Debate the Bot" interface.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"

export const REVIEW_PR_STATUS_SCHEMA = {
  name: "review_pr_status",
  description: "Get the status and details of a kap10 PR review, including blockers, warnings, and remediation guidance. Use this to understand why a PR was blocked.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pr_number: {
        type: "number" as const,
        description: "The PR number to query",
      },
    },
    required: ["pr_number"],
  },
}

export async function handleReviewPrStatus(
  args: Record<string, unknown>,
  ctx: McpAuthContext,
  container: Container
) {
  const prNumber = args.pr_number as number
  if (!prNumber || typeof prNumber !== "number") {
    return {
      content: [{ type: "text", text: "Error: pr_number is required and must be a number" }],
      isError: true,
    }
  }

  const repoId = ctx.repoId
  if (!repoId) {
    return {
      content: [{ type: "text", text: "Error: No repo context. Connect to a repo first." }],
      isError: true,
    }
  }

  // Find latest review for this PR
  const { items } = await container.relationalStore.listPrReviews(repoId, { limit: 50 })
  const review = items.find((r) => r.prNumber === prNumber)

  if (!review) {
    return {
      content: [{
        type: "text",
        text: `No review found for PR #${prNumber} in this repo. Reviews are automatically created when PRs are opened against configured target branches.`,
      }],
    }
  }

  // Fetch comments
  const comments = await container.relationalStore.listPrReviewComments(review.id)
  const blockers = comments.filter((c) => c.severity === "error")
  const warnings = comments.filter((c) => c.severity === "warning")
  const infos = comments.filter((c) => c.severity === "info")

  // Enrich blockers with rule context
  const enrichedBlockers = []
  for (const blocker of blockers) {
    let ruleContext = null
    if (blocker.semgrepRuleId) {
      const rules = await container.graphStore.queryRules(ctx.orgId, {
        orgId: ctx.orgId,
        repoId,
      })
      const rule = rules.find((r) => r.id === blocker.semgrepRuleId || r.name === blocker.semgrepRuleId)
      if (rule) {
        ruleContext = {
          title: rule.title,
          description: rule.description,
          enforcement: rule.enforcement,
          type: rule.type,
        }
      }
    }

    enrichedBlockers.push({
      filePath: blocker.filePath,
      lineNumber: blocker.lineNumber,
      checkType: blocker.checkType,
      message: blocker.message,
      ruleTitle: blocker.ruleTitle,
      suggestion: blocker.suggestion,
      autoFix: blocker.autoFix,
      rule: ruleContext,
    })
  }

  const guidance = blockers.length > 0
    ? `Your PR is blocked by ${blockers.length} rule(s). I can help you refactor the code to satisfy these rules. Would you like me to apply the suggested fixes?`
    : warnings.length > 0
      ? "Your PR has warnings but no blockers. It can be merged."
      : "Your PR passed all checks. No issues found."

  const result = {
    pr: {
      number: prNumber,
      title: review.prTitle,
      url: review.prUrl,
    },
    review: {
      id: review.id,
      status: review.status,
      checksPassed: review.checksPassed,
      checksWarned: review.checksWarned,
      checksFailed: review.checksFailed,
      autoApproved: review.autoApproved,
      postedAt: review.createdAt,
      completedAt: review.completedAt,
    },
    blockers: enrichedBlockers,
    warnings: warnings.map((w) => ({
      filePath: w.filePath,
      lineNumber: w.lineNumber,
      checkType: w.checkType,
      message: w.message,
      ruleTitle: w.ruleTitle,
    })),
    info: infos.map((i) => ({
      filePath: i.filePath,
      lineNumber: i.lineNumber,
      checkType: i.checkType,
      message: i.message,
    })),
    guidance,
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  }
}
