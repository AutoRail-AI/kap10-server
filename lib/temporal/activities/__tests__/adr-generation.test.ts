import { beforeEach, describe, expect, it, vi } from "vitest"
import { type Container, createTestContainer } from "@/lib/di/container"
import { FakeGitHost, MockLLMProvider } from "@/lib/di/fakes"
import { LLM_MODELS } from "@/lib/llm/config"
import type { AdrContent } from "@/lib/ports/types"
import type { SignificanceAssessment } from "@/lib/temporal/activities/adr-generation"

// Mock @temporalio/activity so heartbeat never throws
vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
  Context: { current: () => ({ heartbeat: vi.fn() }) },
}))

// Mock getContainer to return our test container
let testContainer: Container

vi.mock("@/lib/di/container", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/di/container")>()
  return {
    ...original,
    getContainer: () => testContainer,
  }
})

describe("adr-generation activities", () => {
  let fakeGitHost: FakeGitHost
  let mockLlm: MockLLMProvider

  beforeEach(() => {
    fakeGitHost = new FakeGitHost()
    mockLlm = new MockLLMProvider()
    testContainer = createTestContainer({
      gitHost: fakeGitHost,
      llmProvider: mockLlm,
    })
  })

  describe("assessMergeSignificance", () => {
    it("returns significant=false when no entities, feature areas, or boundary changes exist", async () => {
      const { assessMergeSignificance } = await import("@/lib/temporal/activities/adr-generation")

      const result = await assessMergeSignificance({
        orgId: "org-empty",
        repoId: "repo-empty",
        prNumber: 1,
      })

      expect(result).toHaveProperty("significant")
      expect(result).toHaveProperty("reason")
      expect(result).toHaveProperty("newEntityCount")
      expect(result).toHaveProperty("newFeatureAreas")
      expect(result).toHaveProperty("boundaryChanges")
      expect(typeof result.significant).toBe("boolean")
      expect(typeof result.newEntityCount).toBe("number")
      expect(Array.isArray(result.newFeatureAreas)).toBe(true)
      expect(Array.isArray(result.boundaryChanges)).toBe(true)
      // With no data, significance should be false
      expect(result.significant).toBe(false)
    })

    it("returns significant=true when boundary files exist (lib/ports/ or lib/adapters/)", async () => {
      // Seed entities in boundary paths
      await testContainer.graphStore.upsertEntity("org-1", {
        id: "port-entity-1",
        org_id: "org-1",
        repo_id: "repo-1",
        kind: "interface",
        name: "IRelationalStore",
        file_path: "lib/ports/relational-store.ts",
      })
      await testContainer.graphStore.upsertEntity("org-1", {
        id: "adapter-entity-1",
        org_id: "org-1",
        repo_id: "repo-1",
        kind: "class",
        name: "PrismaRelationalStore",
        file_path: "lib/adapters/prisma-relational-store.ts",
      })

      const { assessMergeSignificance } = await import("@/lib/temporal/activities/adr-generation")

      const result = await assessMergeSignificance({
        orgId: "org-1",
        repoId: "repo-1",
        prNumber: 5,
      })

      expect(result.significant).toBe(true)
      expect(result.boundaryChanges.length).toBeGreaterThan(0)
    })

    it("returns significant=true when recent index event has many new entities", async () => {
      // Seed an index event with entities_added >= threshold (default 10)
      await testContainer.graphStore.insertIndexEvent("org-1", {
        org_id: "org-1",
        repo_id: "repo-big",
        push_sha: "sha123",
        commit_message: "big feature",
        event_type: "incremental",
        files_changed: 20,
        entities_added: 15,
        entities_updated: 5,
        entities_deleted: 0,
        edges_repaired: 0,
        embeddings_updated: 15,
        cascade_status: "complete",
        cascade_entities: 0,
        duration_ms: 3000,
        workflow_id: "wf-1",
        created_at: new Date().toISOString(),
      })

      const { assessMergeSignificance } = await import("@/lib/temporal/activities/adr-generation")

      const result = await assessMergeSignificance({
        orgId: "org-1",
        repoId: "repo-big",
        prNumber: 10,
      })

      expect(result.significant).toBe(true)
      expect(result.newEntityCount).toBe(15)
    })

    it("returns significant=false when entities_added is below threshold", async () => {
      // Seed an index event with entities_added < 10
      await testContainer.graphStore.insertIndexEvent("org-1", {
        org_id: "org-1",
        repo_id: "repo-small",
        push_sha: "sha456",
        commit_message: "tiny fix",
        event_type: "incremental",
        files_changed: 1,
        entities_added: 2,
        entities_updated: 0,
        entities_deleted: 0,
        edges_repaired: 0,
        embeddings_updated: 0,
        cascade_status: "none",
        cascade_entities: 0,
        duration_ms: 100,
        workflow_id: "wf-2",
        created_at: new Date().toISOString(),
      })

      const { assessMergeSignificance } = await import("@/lib/temporal/activities/adr-generation")

      const result = await assessMergeSignificance({
        orgId: "org-1",
        repoId: "repo-small",
        prNumber: 11,
      })

      expect(result.newEntityCount).toBe(2)
      // With 2 entities added and no other signals, not significant
      expect(result.significant).toBe(false)
    })
  })

  describe("generateAdr", () => {
    it("returns an AdrContent object using the LLM provider", async () => {
      const adrContent: AdrContent = {
        title: "Use Hexagonal Architecture for Database Access",
        context: "Direct DB calls were leaking into route handlers.",
        decision: "All DB access must go through IRelationalStore port.",
        consequences: "Better testability and ability to swap DB implementations.",
        relatedEntities: ["lib/ports/relational-store.ts", "lib/di/container.ts"],
        relatedFeatureAreas: ["infrastructure", "data-access"],
      }

      mockLlm.generateObject = async <T>(params: { schema: { parse: (v: unknown) => T } }) => ({
        object: params.schema.parse(adrContent) as T,
        usage: { inputTokens: 800, outputTokens: 400 },
      })

      const assessment: SignificanceAssessment = {
        significant: true,
        reason: "15 new entities, 1 new feature area, 2 boundary changes",
        newEntityCount: 15,
        newFeatureAreas: ["data-access"],
        boundaryChanges: ["lib/ports/relational-store.ts"],
      }

      const { generateAdr } = await import("@/lib/temporal/activities/adr-generation")

      const result = await generateAdr({
        orgId: "org-1",
        repoId: "repo-1",
        prNumber: 33,
        prTitle: "feat: introduce hexagonal architecture",
        assessment,
      })

      expect(result).toHaveProperty("title")
      expect(result).toHaveProperty("context")
      expect(result).toHaveProperty("decision")
      expect(result).toHaveProperty("consequences")
      expect(result).toHaveProperty("relatedEntities")
      expect(result).toHaveProperty("relatedFeatureAreas")
      expect(typeof result.title).toBe("string")
      expect(Array.isArray(result.relatedEntities)).toBe(true)
      expect(Array.isArray(result.relatedFeatureAreas)).toBe(true)
    })

    it("logs token usage to graphStore after generation", async () => {
      const adrContent: AdrContent = {
        title: "Token Logging ADR",
        context: "context here",
        decision: "decision here",
        consequences: "consequences here",
        relatedEntities: [],
        relatedFeatureAreas: [],
      }

      mockLlm.generateObject = async <T>(params: { schema: { parse: (v: unknown) => T } }) => ({
        object: params.schema.parse(adrContent) as T,
        usage: { inputTokens: 600, outputTokens: 250 },
      })

      const assessment: SignificanceAssessment = {
        significant: true,
        reason: "test",
        newEntityCount: 12,
        newFeatureAreas: [],
        boundaryChanges: [],
      }

      const { generateAdr } = await import("@/lib/temporal/activities/adr-generation")

      await generateAdr({
        orgId: "org-token",
        repoId: "repo-token",
        prNumber: 50,
        prTitle: "feat: token test",
        assessment,
      })

      const usage = await testContainer.graphStore.getTokenUsage("org-token", "repo-token")
      const adrUsage = usage.find((u) => u.activity === "adr-generation")
      expect(adrUsage).toBeDefined()
      expect(adrUsage!.input_tokens).toBe(600)
      expect(adrUsage!.output_tokens).toBe(250)
      expect(adrUsage!.model).toBe(LLM_MODELS.standard)
    })
  })

  describe("commitAdrPr", () => {
    it("creates a branch, commits the ADR file, and opens a PR via gitHost", async () => {
      const adrContent: AdrContent = {
        title: "Adopt Hexagonal Architecture",
        context: "We need clear boundaries between business logic and infra.",
        decision: "Implement ports and adapters pattern.",
        consequences: "All infra access goes through ports.",
        relatedEntities: ["lib/ports/types.ts"],
        relatedFeatureAreas: ["infrastructure"],
      }

      const { commitAdrPr } = await import("@/lib/temporal/activities/adr-generation")

      const _result = await commitAdrPr({
        orgId: "org-1",
        repoId: "repo-1",
        owner: "acme",
        repo: "web",
        prNumber: 77,
        installationId: 999,
        headSha: "mergesha123",
        adrContent,
      })

      // Verify branch was created
      expect(fakeGitHost.branches.length).toBe(1)
      expect(fakeGitHost.branches[0]!.name).toBe("unerr/adr-pr-77")
      expect(fakeGitHost.branches[0]!.fromSha).toBe("mergesha123")
      expect(fakeGitHost.branches[0]!.owner).toBe("acme")
      expect(fakeGitHost.branches[0]!.repo).toBe("web")
    })

    it("commits a markdown file with the ADR content to the branch", async () => {
      const adrContent: AdrContent = {
        title: "Use Redis for Session Caching",
        context: "Session state was being stored in-process.",
        decision: "Use Redis via ICacheStore port.",
        consequences: "Horizontal scaling is now possible.",
        relatedEntities: ["lib/ports/cache-store.ts"],
        relatedFeatureAreas: ["infrastructure", "session"],
      }

      const { commitAdrPr } = await import("@/lib/temporal/activities/adr-generation")

      await commitAdrPr({
        orgId: "org-1",
        repoId: "repo-1",
        owner: "acme",
        repo: "web",
        prNumber: 88,
        installationId: 999,
        headSha: "sha888",
        adrContent,
      })

      // Verify file was created
      expect(fakeGitHost.files.length).toBeGreaterThanOrEqual(1)
      const createdFile = fakeGitHost.files.find((f) => f.branch === "unerr/adr-pr-88")
      expect(createdFile).toBeDefined()
      expect(createdFile!.path).toContain("docs/adr/")
      expect(createdFile!.path).toContain(".md")
      // Content should contain the ADR title
      expect(createdFile!.content).toContain("Use Redis for Session Caching")
    })

    it("opens a pull request and returns the PR number and URL", async () => {
      // Override createPullRequest to return a specific PR
      fakeGitHost.createPullRequest = async (_owner, _repo, _params) => ({
        number: 123,
        title: "docs: ADR — Adopt Event Sourcing",
        htmlUrl: "https://github.com/acme/web/pull/123",
      })

      const adrContent: AdrContent = {
        title: "Adopt Event Sourcing",
        context: "We need an audit trail.",
        decision: "Use Temporal workflows for all state changes.",
        consequences: "All mutations are now tracked.",
        relatedEntities: [],
        relatedFeatureAreas: ["workflows"],
      }

      const { commitAdrPr } = await import("@/lib/temporal/activities/adr-generation")

      const result = await commitAdrPr({
        orgId: "org-1",
        repoId: "repo-1",
        owner: "acme",
        repo: "web",
        prNumber: 100,
        installationId: 999,
        headSha: "sha100",
        adrContent,
      })

      expect(result).toHaveProperty("prNumber")
      expect(result).toHaveProperty("prUrl")
      expect(result.prNumber).toBe(123)
      expect(result.prUrl).toContain("github.com")
    })
  })
})
