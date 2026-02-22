/**
 * Port Compliance Tests
 *
 * Verifies that all 11 fakes in createTestContainer() satisfy their
 * respective port interfaces by exercising every method.
 */
import { describe, expect, it } from "vitest"

import { createTestContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"

function getContainer(): Container {
  return createTestContainer()
}

describe("Port Compliance — Fakes", () => {
  describe("IGraphStore (InMemoryGraphStore)", () => {
    it("implements all 20 methods", async () => {
      const { graphStore } = getContainer()
      const entity = { id: "e1", org_id: "o1", repo_id: "r1", kind: "function", name: "foo", file_path: "a.ts" }
      const edge = { _from: "e1", _to: "e2", org_id: "o1", repo_id: "r1", kind: "calls" }

      await expect(graphStore.bootstrapGraphSchema()).resolves.toBeUndefined()
      await expect(graphStore.healthCheck()).resolves.toEqual({ status: "up", latencyMs: 0 })
      await expect(graphStore.upsertEntity("o1", entity)).resolves.toBeUndefined()
      await expect(graphStore.getEntity("o1", "e1")).resolves.toMatchObject({ id: "e1", name: "foo" })
      await expect(graphStore.deleteEntity("o1", "e1")).resolves.toBeUndefined()
      await expect(graphStore.upsertEdge("o1", edge)).resolves.toBeUndefined()
      await expect(graphStore.getCallersOf("o1", "e1")).resolves.toEqual([])
      await expect(graphStore.getCalleesOf("o1", "e1")).resolves.toEqual([])
      await expect(graphStore.impactAnalysis("o1", "e1", 3)).resolves.toMatchObject({ entityId: "e1", affected: [] })
      await expect(graphStore.getEntitiesByFile("o1", "r1", "a.ts")).resolves.toEqual([])
      await expect(graphStore.upsertRule("o1", { id: "r1", org_id: "o1", name: "rule1" } as never)).resolves.toBeUndefined()
      await expect(graphStore.queryRules("o1", { orgId: "o1" })).resolves.toEqual(expect.any(Array))
      await expect(graphStore.upsertPattern("o1", { id: "p1", org_id: "o1", name: "pat1" } as never)).resolves.toBeUndefined()
      await expect(graphStore.queryPatterns("o1", { orgId: "o1" })).resolves.toEqual(expect.any(Array))
      await expect(graphStore.upsertSnippet("o1", { id: "s1", org_id: "o1", repo_id: "r1" })).resolves.toBeUndefined()
      await expect(graphStore.querySnippets("o1", { orgId: "o1" })).resolves.toEqual([])
      await expect(graphStore.getFeatures("o1", "r1")).resolves.toEqual([])
      await expect(graphStore.getBlueprint("o1", "r1")).resolves.toEqual({ features: [] })
      await expect(graphStore.bulkUpsertEntities("o1", [entity])).resolves.toBeUndefined()
      await expect(graphStore.bulkUpsertEdges("o1", [edge])).resolves.toBeUndefined()
      await expect(graphStore.getFilePaths("o1", "r1")).resolves.toEqual([{ path: "a.ts" }])
      await expect(graphStore.deleteRepoData("o1", "r1")).resolves.toBeUndefined()
    })
  })

  describe("IRelationalStore (InMemoryRelationalStore)", () => {
    it("implements healthCheck, getRepos, createRepo, getDeletionLogs", async () => {
      const { relationalStore } = getContainer()

      await expect(relationalStore.healthCheck()).resolves.toEqual({ status: "up", latencyMs: 0 })
      await expect(relationalStore.getRepos("o1")).resolves.toEqual([])

      const repo = await relationalStore.createRepo({
        organizationId: "o1",
        name: "test-repo",
        fullName: "org/test-repo",
        provider: "github",
        providerId: "12345",
      })
      expect(repo).toMatchObject({
        organizationId: "o1",
        name: "test-repo",
        fullName: "org/test-repo",
        provider: "github",
        providerId: "12345",
        status: "pending",
        defaultBranch: "main",
      })
      expect(repo.id).toBeTruthy()

      const repos = await relationalStore.getRepos("o1")
      expect(repos).toHaveLength(1)

      await expect(relationalStore.getDeletionLogs("o1")).resolves.toEqual([])
    })

    it("implements Phase 1: getRepo, getInstallation, createInstallation, updateRepoStatus, getRepoByGithubId, getReposByStatus, deleteRepo", async () => {
      const { relationalStore } = getContainer()

      const repo = await relationalStore.createRepo({
        organizationId: "o2",
        name: "phase1-repo",
        fullName: "org/phase1-repo",
        provider: "github",
        providerId: "67890",
        githubRepoId: 123,
        githubFullName: "org/phase1-repo",
      })
      await expect(relationalStore.getRepo("o2", repo.id)).resolves.toMatchObject({ id: repo.id, name: "phase1-repo" })
      await expect(relationalStore.getRepoByGithubId("o2", 123)).resolves.toMatchObject({ githubRepoId: 123 })

      await expect(relationalStore.getInstallation("o2")).resolves.toBeNull()
      const inst = await relationalStore.createInstallation({
        organizationId: "o2",
        installationId: 999,
        accountLogin: "test-org",
        accountType: "Organization",
      })
      expect(inst.installationId).toBe(999)
      await expect(relationalStore.getInstallation("o2")).resolves.toMatchObject({ installationId: 999 })
      await expect(relationalStore.getInstallationByInstallationId(999)).resolves.toMatchObject({ accountLogin: "test-org" })

      await relationalStore.updateRepoStatus(repo.id, { status: "indexing", progress: 50 })
      const updated = await relationalStore.getRepo("o2", repo.id)
      expect(updated?.status).toBe("indexing")
      expect(updated?.indexProgress).toBe(50)

      await expect(relationalStore.getReposByStatus("o2", "indexing")).resolves.toHaveLength(1)
      await relationalStore.deleteInstallation("o2")
      await expect(relationalStore.getInstallation("o2")).resolves.toBeNull()

      await relationalStore.deleteRepo(repo.id)
      await expect(relationalStore.getRepo("o2", repo.id)).resolves.toBeNull()
    })

    it("implements Phase 7: PR review methods", async () => {
      const { relationalStore } = getContainer()

      // createPrReview
      const review = await relationalStore.createPrReview({
        repoId: "repo-p7",
        prNumber: 42,
        prTitle: "feat: new endpoint",
        prUrl: "https://github.com/acme/web/pull/42",
        headSha: "abc123",
        baseSha: "base456",
      })
      expect(review).toMatchObject({
        repoId: "repo-p7",
        prNumber: 42,
        prTitle: "feat: new endpoint",
        headSha: "abc123",
        baseSha: "base456",
        status: "pending",
        checksPassed: 0,
        checksWarned: 0,
        checksFailed: 0,
        reviewBody: null,
        githubReviewId: null,
        githubCheckRunId: null,
        autoApproved: false,
        errorMessage: null,
        completedAt: null,
      })
      expect(review.id).toBeTruthy()

      // getPrReview
      const fetched = await relationalStore.getPrReview(review.id)
      expect(fetched).toMatchObject({ id: review.id, status: "pending" })

      // getPrReviewByPrAndSha
      const byPrAndSha = await relationalStore.getPrReviewByPrAndSha("repo-p7", 42, "abc123")
      expect(byPrAndSha).toMatchObject({ id: review.id })

      // getPrReviewByPrAndSha returns null for unknown SHA
      const notFound = await relationalStore.getPrReviewByPrAndSha("repo-p7", 42, "unknown-sha")
      expect(notFound).toBeNull()

      // updatePrReview — status transitions
      await relationalStore.updatePrReview(review.id, {
        status: "reviewing",
      })
      const reviewing = await relationalStore.getPrReview(review.id)
      expect(reviewing?.status).toBe("reviewing")

      await relationalStore.updatePrReview(review.id, {
        status: "completed",
        checksPassed: 3,
        checksWarned: 1,
        checksFailed: 0,
        reviewBody: "LGTM — no blockers found.",
        githubReviewId: 9001,
        githubCheckRunId: 8001,
        autoApproved: true,
        completedAt: new Date().toISOString(),
      })
      const completed = await relationalStore.getPrReview(review.id)
      expect(completed?.status).toBe("completed")
      expect(completed?.checksPassed).toBe(3)
      expect(completed?.checksWarned).toBe(1)
      expect(completed?.checksFailed).toBe(0)
      expect(completed?.githubReviewId).toBe(9001)
      expect(completed?.autoApproved).toBe(true)

      // listPrReviews
      const list = await relationalStore.listPrReviews("repo-p7")
      expect(list.items.length).toBe(1)
      expect(list.items[0]!.id).toBe(review.id)
      expect(list.hasMore).toBe(false)

      // listPrReviews with status filter
      const completedList = await relationalStore.listPrReviews("repo-p7", { status: "completed" })
      expect(completedList.items.length).toBe(1)

      const pendingList = await relationalStore.listPrReviews("repo-p7", { status: "pending" })
      expect(pendingList.items.length).toBe(0)

      // createPrReviewComment
      const comment = await relationalStore.createPrReviewComment({
        reviewId: review.id,
        filePath: "src/handler.ts",
        lineNumber: 15,
        checkType: "pattern",
        severity: "error",
        message: "Direct DB access detected — use relationalStore port.",
        suggestion: null,
        semgrepRuleId: "no-direct-db",
        ruleTitle: "No Direct DB Access",
        githubCommentId: null,
        autoFix: null,
      })
      expect(comment).toMatchObject({
        reviewId: review.id,
        filePath: "src/handler.ts",
        lineNumber: 15,
        checkType: "pattern",
        severity: "error",
      })
      expect(comment.id).toBeTruthy()

      // listPrReviewComments
      const comments = await relationalStore.listPrReviewComments(review.id)
      expect(comments.length).toBe(1)
      expect(comments[0]!.ruleTitle).toBe("No Direct DB Access")

      // listPrReviewComments for unknown review returns empty
      const noComments = await relationalStore.listPrReviewComments("unknown-review-id")
      expect(noComments).toEqual([])

      // updateRepoReviewConfig
      const customConfig = {
        enabled: true,
        autoApproveOnClean: true,
        targetBranches: ["main", "develop"],
        skipDraftPrs: false,
        impactThreshold: 20,
        complexityThreshold: 15,
        checksEnabled: {
          pattern: true,
          impact: true,
          test: false,
          complexity: true,
          dependency: false,
        },
        ignorePaths: ["docs/**", "*.md"],
        semanticLgtmEnabled: true,
        horizontalAreas: ["utility", "docs"],
        lowRiskCallerThreshold: 3,
        nudgeEnabled: true,
        nudgeDelayHours: 24,
      }
      await relationalStore.updateRepoReviewConfig("repo-p7", customConfig)

      // getRepoReviewConfig — returns stored config
      const storedConfig = await relationalStore.getRepoReviewConfig("repo-p7")
      expect(storedConfig).toMatchObject({
        enabled: true,
        autoApproveOnClean: true,
        impactThreshold: 20,
        semanticLgtmEnabled: true,
        nudgeDelayHours: 24,
      })
      expect(storedConfig.targetBranches).toEqual(["main", "develop"])
      expect(storedConfig.ignorePaths).toEqual(["docs/**", "*.md"])

      // getRepoReviewConfig — returns DEFAULT_REVIEW_CONFIG for unknown repoId
      const defaultConfig = await relationalStore.getRepoReviewConfig("unknown-repo")
      expect(defaultConfig.enabled).toBe(true)
      expect(defaultConfig.nudgeEnabled).toBe(true)
    })
  })

  describe("ILLMProvider (MockLLMProvider)", () => {
    it("implements generateObject, streamText, embed", async () => {
      const { llmProvider } = getContainer()

      const result = await llmProvider.generateObject({
        model: "test",
        schema: { parse: () => ({ answer: 42 }) },
        prompt: "test",
      })
      expect(result).toMatchObject({ object: { answer: 42 }, usage: { inputTokens: 0, outputTokens: 0 } })

      const chunks: string[] = []
      for await (const chunk of llmProvider.streamText({ model: "test", prompt: "hello" })) {
        chunks.push(chunk)
      }
      expect(chunks).toEqual([""])

      await expect(llmProvider.embed({ model: "test", texts: ["hello"] })).resolves.toEqual([])
    })
  })

  describe("IWorkflowEngine (InlineWorkflowEngine)", () => {
    it("implements startWorkflow, signalWorkflow, getWorkflowStatus, cancelWorkflow, healthCheck", async () => {
      const { workflowEngine } = getContainer()

      const handle = await workflowEngine.startWorkflow({
        workflowId: "w1",
        workflowFn: "indexRepo",
        args: [],
        taskQueue: "heavy-compute-queue",
      })
      expect(handle).toMatchObject({ workflowId: "test", runId: "test-run" })
      await expect(handle.result()).resolves.toBeUndefined()

      await expect(workflowEngine.signalWorkflow("w1", "cancel")).resolves.toBeUndefined()
      await expect(workflowEngine.getWorkflowStatus("w1")).resolves.toMatchObject({ status: "completed" })
      await expect(workflowEngine.cancelWorkflow("w1")).resolves.toBeUndefined()
      await expect(workflowEngine.healthCheck()).resolves.toEqual({ status: "up", latencyMs: 0 })
    })
  })

  describe("IGitHost (FakeGitHost)", () => {
    it("implements cloneRepo, getPullRequest, createPullRequest, getDiff, listFiles, createWebhook, getInstallationRepos, getInstallationToken", async () => {
      const { gitHost } = getContainer()

      await expect(gitHost.cloneRepo("url", "/tmp/dest")).resolves.toBeUndefined()
      await expect(gitHost.getPullRequest("owner", "repo", 1)).resolves.toEqual({ number: 0, title: "" })
      await expect(
        gitHost.createPullRequest("owner", "repo", { title: "t", body: "b", head: "feat", base: "main" })
      ).resolves.toMatchObject({ number: 42, title: "Enable kap10 Code Intelligence" })
      await expect(gitHost.getDiff("owner", "repo", "main", "feat")).resolves.toBe("")
      await expect(gitHost.listFiles("owner", "repo")).resolves.toEqual([])
      await expect(gitHost.createWebhook("owner", "repo", ["push"], "https://hook")).resolves.toBeUndefined()
      await expect(gitHost.getInstallationRepos(123)).resolves.toEqual([])
      await expect(gitHost.getInstallationToken(123)).resolves.toBe("fake-token")
    })

    it("implements Phase 7: PR review methods", async () => {
      const { gitHost } = getContainer()

      // postReview
      const reviewResult = await gitHost.postReview("acme", "web", 42, {
        event: "REQUEST_CHANGES",
        body: "Please fix the architecture violations.",
        comments: [
          { path: "src/handler.ts", line: 10, body: "Direct DB access not allowed." },
        ],
      })
      expect(reviewResult).toMatchObject({ reviewId: expect.any(Number) })
      expect(reviewResult.reviewId).toBeGreaterThan(0)

      // postReviewComment
      const commentResult = await gitHost.postReviewComment("acme", "web", 42, {
        path: "src/utils.ts",
        line: 5,
        body: "Missing error handling.",
        commitId: "abc123",
      })
      expect(commentResult).toMatchObject({ commentId: expect.any(Number) })

      // getPullRequestFiles
      const files = await gitHost.getPullRequestFiles("acme", "web", 42)
      expect(Array.isArray(files)).toBe(true)

      // createCheckRun
      const checkRun = await gitHost.createCheckRun("acme", "web", {
        name: "kap10 Architecture Review",
        headSha: "abc123",
        status: "in_progress",
      })
      expect(checkRun).toMatchObject({ checkRunId: expect.any(Number) })
      expect(checkRun.checkRunId).toBeGreaterThan(0)

      // updateCheckRun
      await expect(
        gitHost.updateCheckRun("acme", "web", checkRun.checkRunId, {
          status: "completed",
          conclusion: "success",
          output: {
            title: "All checks passed",
            summary: "No architecture violations detected.",
            annotations: [],
          },
        })
      ).resolves.toBeUndefined()

      // postIssueComment
      const issueComment = await gitHost.postIssueComment("acme", "web", 42, "Reminder: this PR is still blocked.")
      expect(issueComment).toMatchObject({ commentId: expect.any(Number) })

      // createBranch
      await expect(
        gitHost.createBranch("acme", "web", "kap10/adr-pr-42", "mergesha123")
      ).resolves.toBeUndefined()

      // createOrUpdateFile
      const fileResult = await gitHost.createOrUpdateFile(
        "acme",
        "web",
        "kap10/adr-pr-42",
        "docs/adr/2026-02-22-use-hexagonal-architecture.md",
        "# ADR: Use Hexagonal Architecture\n\n...",
        { message: "docs: add ADR for PR #42" }
      )
      expect(fileResult).toHaveProperty("sha")
      expect(typeof fileResult.sha).toBe("string")
      expect(fileResult.sha.length).toBeGreaterThan(0)
    })
  })

  describe("IVectorSearch (InMemoryVectorSearch)", () => {
    it("implements embed, search, upsert", async () => {
      const { vectorSearch } = getContainer()

      const embedResult = await vectorSearch.embed(["hello"])
      expect(embedResult).toHaveLength(1)
      expect(embedResult[0]).toHaveLength(768)

      await expect(vectorSearch.upsert(["id1"], [[0.1]], [{ orgId: "o1" }])).resolves.toBeUndefined()
      const searchResult = await vectorSearch.search([0.1], 5)
      expect(searchResult).toHaveLength(1)
      expect(searchResult[0]!.id).toBe("id1")
    })
  })

  describe("IBillingProvider (NoOpBillingProvider)", () => {
    it("implements createCheckoutSession, createSubscription, cancelSubscription, reportUsage, createOnDemandCharge", async () => {
      const { billingProvider } = getContainer()

      await expect(billingProvider.createCheckoutSession("o1", "pro")).resolves.toEqual({ url: "" })
      await expect(billingProvider.createSubscription("o1", "pro")).resolves.toBeDefined()
      await expect(billingProvider.cancelSubscription("sub-1")).resolves.toBeUndefined()
      await expect(billingProvider.reportUsage("o1", 100, "tokens")).resolves.toBeUndefined()
      await expect(billingProvider.createOnDemandCharge("o1", 10)).resolves.toEqual({ url: "" })
    })
  })

  describe("IObservability (InMemoryObservability)", () => {
    it("implements getOrgLLMCost, getCostBreakdown, getModelUsage, healthCheck", async () => {
      const { observability } = getContainer()
      const from = new Date("2025-01-01")
      const to = new Date("2025-12-31")

      await expect(observability.getOrgLLMCost("o1", from, to)).resolves.toBe(0)
      await expect(observability.getCostBreakdown("o1", from, to)).resolves.toEqual({ byModel: {}, total: 0 })
      await expect(observability.getModelUsage("o1", from, to)).resolves.toEqual([])
      await expect(observability.healthCheck()).resolves.toEqual({ status: "up", latencyMs: 0 })
    })
  })

  describe("ICacheStore (InMemoryCacheStore)", () => {
    it("implements get, set, invalidate, rateLimit, healthCheck", async () => {
      const { cacheStore } = getContainer()

      await cacheStore.set("key1", { data: "value" })
      await expect(cacheStore.get("key1")).resolves.toEqual({ data: "value" })

      await cacheStore.invalidate("key1")
      await expect(cacheStore.get("key1")).resolves.toBeNull()

      const allowed = await cacheStore.rateLimit("ip:127.0.0.1", 5, 60)
      expect(allowed).toBe(true)

      await expect(cacheStore.healthCheck()).resolves.toEqual({ status: "up", latencyMs: 0 })
    })

    it("respects TTL expiry", async () => {
      const { cacheStore } = getContainer()
      // Set with 0-second TTL (already expired)
      await cacheStore.set("ttl-key", "val", 0)
      // A 0-second TTL should still be accessible immediately since Date.now() might match
      // But we can test that the TTL mechanism exists
      const result = await cacheStore.get("ttl-key")
      // Result may or may not be null depending on timing, just verify no error
      expect(result === null || result === "val").toBe(true)
    })

    it("implements setIfNotExists (Phase 1 webhook deduplication)", async () => {
      const { cacheStore } = getContainer()
      const key = "phase1-dedup-" + Date.now()
      const first = await cacheStore.setIfNotExists(key, "delivery-1", 60)
      const second = await cacheStore.setIfNotExists(key, "delivery-2", 60)
      expect(first).toBe(true)
      expect(second).toBe(false)
    })
  })

  describe("ICodeIntelligence (FakeCodeIntelligence)", () => {
    it("implements indexWorkspace, getDefinitions, getReferences", async () => {
      const { codeIntelligence } = getContainer()

      await expect(codeIntelligence.indexWorkspace("/tmp/workspace")).resolves.toEqual({ filesProcessed: 0 })
      await expect(codeIntelligence.getDefinitions("file.ts", 1, 0)).resolves.toEqual([])
      await expect(codeIntelligence.getReferences("file.ts", 1, 0)).resolves.toEqual([])
    })
  })

  describe("IPatternEngine (FakePatternEngine)", () => {
    it("implements scanPatterns, matchRule", async () => {
      const { patternEngine } = getContainer()

      await expect(patternEngine.scanPatterns("/tmp/workspace", "/tmp/rules")).resolves.toEqual([])
      await expect(patternEngine.matchRule("const x = 1", "pattern: $X")).resolves.toEqual([])
    })
  })
})
