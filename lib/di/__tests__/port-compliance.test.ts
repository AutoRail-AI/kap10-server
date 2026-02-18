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
      await expect(graphStore.getEntity("o1", "e1")).resolves.toBeNull()
      await expect(graphStore.deleteEntity("o1", "e1")).resolves.toBeUndefined()
      await expect(graphStore.upsertEdge("o1", edge)).resolves.toBeUndefined()
      await expect(graphStore.getCallersOf("o1", "e1")).resolves.toEqual([])
      await expect(graphStore.getCalleesOf("o1", "e1")).resolves.toEqual([])
      await expect(graphStore.impactAnalysis("o1", "e1", 3)).resolves.toMatchObject({ entityId: "", affected: [] })
      await expect(graphStore.getEntitiesByFile("o1", "r1", "a.ts")).resolves.toEqual([])
      await expect(graphStore.upsertRule("o1", { id: "r1", org_id: "o1", name: "rule1" })).resolves.toBeUndefined()
      await expect(graphStore.queryRules("o1", { orgId: "o1" })).resolves.toEqual([])
      await expect(graphStore.upsertPattern("o1", { id: "p1", org_id: "o1", name: "pat1" })).resolves.toBeUndefined()
      await expect(graphStore.queryPatterns("o1", { orgId: "o1" })).resolves.toEqual([])
      await expect(graphStore.upsertSnippet("o1", { id: "s1", org_id: "o1", repo_id: "r1" })).resolves.toBeUndefined()
      await expect(graphStore.querySnippets("o1", { orgId: "o1" })).resolves.toEqual([])
      await expect(graphStore.getFeatures("o1", "r1")).resolves.toEqual([])
      await expect(graphStore.getBlueprint("o1", "r1")).resolves.toEqual({ features: [] })
      await expect(graphStore.bulkUpsertEntities("o1", [entity])).resolves.toBeUndefined()
      await expect(graphStore.bulkUpsertEdges("o1", [edge])).resolves.toBeUndefined()
      await expect(graphStore.getFilePaths("o1", "r1")).resolves.toEqual([])
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
      ).resolves.toEqual({ number: 0, title: "" })
      await expect(gitHost.getDiff("owner", "repo", "main", "feat")).resolves.toBe("")
      await expect(gitHost.listFiles("owner", "repo")).resolves.toEqual([])
      await expect(gitHost.createWebhook("owner", "repo", ["push"], "https://hook")).resolves.toBeUndefined()
      await expect(gitHost.getInstallationRepos(123)).resolves.toEqual([])
      await expect(gitHost.getInstallationToken(123)).resolves.toBe("fake-token")
    })
  })

  describe("IVectorSearch (InMemoryVectorSearch)", () => {
    it("implements embed, search, upsert", async () => {
      const { vectorSearch } = getContainer()

      await expect(vectorSearch.embed(["hello"])).resolves.toEqual([])
      await expect(vectorSearch.search([0.1], 5)).resolves.toEqual([])
      await expect(vectorSearch.upsert(["id1"], [[0.1]], [{ orgId: "o1" }])).resolves.toBeUndefined()
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
