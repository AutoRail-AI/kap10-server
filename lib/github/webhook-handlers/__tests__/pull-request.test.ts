import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { handlePullRequestEvent, type PullRequestPayload } from "../pull-request"
import type { ReviewConfig } from "@/lib/ports/types"
import { DEFAULT_REVIEW_CONFIG } from "@/lib/ports/types"

const ORG = "org-pr-webhook"
const GITHUB_REPO_ID = 999001
const INSTALLATION_ID = 12345

function makePayload(overrides: Partial<PullRequestPayload> = {}): PullRequestPayload {
  return {
    action: "opened",
    number: 42,
    pull_request: {
      number: 42,
      title: "Feature: add new endpoint",
      html_url: "https://github.com/acme/app/pull/42",
      head: { sha: "abc123headsha", ref: "feature/new-endpoint" },
      base: { sha: "def456basesha", ref: "main" },
      draft: false,
      merged: false,
      state: "open",
      user: { login: "developer" },
    },
    repository: {
      id: GITHUB_REPO_ID,
      full_name: "acme/app",
      default_branch: "main",
      owner: { login: "acme" },
      name: "app",
    },
    installation: { id: INSTALLATION_ID },
    sender: { login: "developer" },
    ...overrides,
  }
}

describe("handlePullRequestEvent", () => {
  let container: Container
  let repoId: string

  beforeEach(async () => {
    container = createTestContainer()

    // Seed installation
    await container.relationalStore.createInstallation({
      organizationId: ORG,
      installationId: INSTALLATION_ID,
      accountLogin: "acme",
      accountType: "Organization",
    })

    // Seed repo with "ready" status
    const repo = await container.relationalStore.createRepo({
      organizationId: ORG,
      name: "app",
      fullName: "acme/app",
      provider: "github",
      providerId: String(GITHUB_REPO_ID),
      githubRepoId: GITHUB_REPO_ID,
      status: "ready",
    })
    repoId = repo.id

    // Configure review settings
    const config: ReviewConfig = {
      ...DEFAULT_REVIEW_CONFIG,
      enabled: true,
      skipDraftPrs: true,
      targetBranches: ["main"],
    }
    await container.relationalStore.updateRepoReviewConfig(repoId, config)
  })

  describe("guard: missing installation", () => {
    it("returns skipped when payload has no installation id", async () => {
      const payload = makePayload()
      delete (payload as Partial<PullRequestPayload>).installation

      const result = await handlePullRequestEvent(payload, container)
      expect(result.action).toBe("skipped")
      expect(result.reason).toContain("No installation ID")
    })

    it("returns skipped when installation is not found in the store", async () => {
      const payload = makePayload({
        installation: { id: 999999 }, // unknown installation
      })

      const result = await handlePullRequestEvent(payload, container)
      expect(result.action).toBe("skipped")
      expect(result.reason).toContain("Installation not found")
    })

    it("returns skipped when repo is not registered", async () => {
      const payload = makePayload({
        repository: {
          id: 8888888, // unregistered github repo id
          full_name: "acme/unknown",
          default_branch: "main",
          owner: { login: "acme" },
          name: "unknown",
        },
      })

      const result = await handlePullRequestEvent(payload, container)
      expect(result.action).toBe("skipped")
      expect(result.reason).toContain("Repo not registered")
    })
  })

  describe("action: opened — creates review and starts workflow", () => {
    it("creates a PrReview record when PR is opened", async () => {
      const payload = makePayload({ action: "opened" })
      const result = await handlePullRequestEvent(payload, container)

      expect(result.action).toBe("review")
      expect(result.workflowId).toContain("review-")

      // Confirm the review was persisted
      const { items } = await container.relationalStore.listPrReviews(repoId)
      expect(items).toHaveLength(1)
      expect(items[0]!.prNumber).toBe(42)
      expect(items[0]!.headSha).toBe("abc123headsha")
      expect(items[0]!.status).toBe("pending")
    })

    it("starts a workflow with the correct workflowFn on opened", async () => {
      const payload = makePayload({ action: "opened" })
      const result = await handlePullRequestEvent(payload, container)

      expect(result.action).toBe("review")
      expect(result.workflowId).toContain(`${ORG}-${repoId}-42-abc123headsha`)
    })

    it("also creates a review when action is synchronize", async () => {
      const payload = makePayload({
        action: "synchronize",
        pull_request: {
          number: 42,
          title: "Feature: add new endpoint",
          html_url: "https://github.com/acme/app/pull/42",
          head: { sha: "newsha999", ref: "feature/new-endpoint" },
          base: { sha: "def456basesha", ref: "main" },
          draft: false,
          merged: false,
          state: "open",
          user: { login: "developer" },
        },
      })

      const result = await handlePullRequestEvent(payload, container)
      expect(result.action).toBe("review")
    })

    it("also creates a review when action is reopened", async () => {
      const payload = makePayload({ action: "reopened" })
      const result = await handlePullRequestEvent(payload, container)
      expect(result.action).toBe("review")
    })
  })

  describe("guard: draft PRs", () => {
    it("skips draft PRs when skipDraftPrs is true", async () => {
      const payload = makePayload({
        pull_request: {
          number: 42,
          title: "WIP: draft feature",
          html_url: "https://github.com/acme/app/pull/42",
          head: { sha: "abc123headsha", ref: "feature/draft" },
          base: { sha: "def456basesha", ref: "main" },
          draft: true,
          merged: false,
          state: "open",
          user: { login: "developer" },
        },
      })

      const result = await handlePullRequestEvent(payload, container)
      expect(result.action).toBe("skipped")
      expect(result.reason).toContain("Draft PR skipped")
    })

    it("processes draft PRs when skipDraftPrs is false", async () => {
      await container.relationalStore.updateRepoReviewConfig(repoId, {
        ...DEFAULT_REVIEW_CONFIG,
        enabled: true,
        skipDraftPrs: false,
        targetBranches: ["main"],
      })

      const payload = makePayload({
        pull_request: {
          number: 42,
          title: "WIP: draft feature",
          html_url: "https://github.com/acme/app/pull/42",
          head: { sha: "draftsha111", ref: "feature/draft" },
          base: { sha: "def456basesha", ref: "main" },
          draft: true,
          merged: false,
          state: "open",
          user: { login: "developer" },
        },
      })

      const result = await handlePullRequestEvent(payload, container)
      expect(result.action).toBe("review")
    })
  })

  describe("guard: reviews disabled", () => {
    it("skips when reviews are disabled in config", async () => {
      await container.relationalStore.updateRepoReviewConfig(repoId, {
        ...DEFAULT_REVIEW_CONFIG,
        enabled: false,
      })

      const payload = makePayload({ action: "opened" })
      const result = await handlePullRequestEvent(payload, container)

      expect(result.action).toBe("skipped")
      expect(result.reason).toContain("Reviews disabled")
    })
  })

  describe("idempotency", () => {
    it("returns skipped for duplicate SHA (review already exists)", async () => {
      const payload = makePayload({ action: "opened" })

      // First call creates the review
      const first = await handlePullRequestEvent(payload, container)
      expect(first.action).toBe("review")

      // Second call with same PR number and same SHA should be idempotent
      const second = await handlePullRequestEvent(payload, container)
      expect(second.action).toBe("skipped")
      expect(second.reason).toContain("Review already exists for this SHA")
    })

    it("creates a new review for a different SHA (force push)", async () => {
      const first = await handlePullRequestEvent(makePayload({ action: "opened" }), container)
      expect(first.action).toBe("review")

      const secondPayload = makePayload({
        action: "synchronize",
        pull_request: {
          number: 42,
          title: "Feature: add new endpoint",
          html_url: "https://github.com/acme/app/pull/42",
          head: { sha: "newpushsha999", ref: "feature/new-endpoint" },
          base: { sha: "def456basesha", ref: "main" },
          draft: false,
          merged: false,
          state: "open",
          user: { login: "developer" },
        },
      })

      const second = await handlePullRequestEvent(secondPayload, container)
      expect(second.action).toBe("review")
    })
  })

  describe("action: closed + merged", () => {
    it("starts merge-ledger workflow when PR is closed and merged", async () => {
      const payload = makePayload({
        action: "closed",
        pull_request: {
          number: 42,
          title: "Feature: add new endpoint",
          html_url: "https://github.com/acme/app/pull/42",
          head: { sha: "mergedsha123", ref: "feature/new-endpoint" },
          base: { sha: "def456basesha", ref: "main" },
          draft: false,
          merged: true,
          state: "closed",
          user: { login: "developer" },
        },
      })

      const result = await handlePullRequestEvent(payload, container)
      expect(result.action).toBe("merge")
      expect(result.workflowId).toContain("merge-ledger-")
      expect(result.workflowId).toContain(String(42))
    })

    it("returns skipped when PR is closed without merge", async () => {
      const payload = makePayload({
        action: "closed",
        pull_request: {
          number: 42,
          title: "Feature: add new endpoint",
          html_url: "https://github.com/acme/app/pull/42",
          head: { sha: "closedsha123", ref: "feature/new-endpoint" },
          base: { sha: "def456basesha", ref: "main" },
          draft: false,
          merged: false,
          state: "closed",
          user: { login: "developer" },
        },
      })

      const result = await handlePullRequestEvent(payload, container)
      expect(result.action).toBe("skipped")
      expect(result.reason).toContain("closed without merge")
    })
  })

  describe("guard: unknown action", () => {
    it("returns skipped for unsupported action types", async () => {
      const payload = makePayload({ action: "labeled" })
      const result = await handlePullRequestEvent(payload, container)

      expect(result.action).toBe("skipped")
      expect(result.reason).toContain("Unknown action")
    })
  })

  describe("guard: repo not ready", () => {
    it("returns skipped when repo is not in ready state", async () => {
      await container.relationalStore.updateRepoStatus(repoId, { status: "indexing" })

      const payload = makePayload({ action: "opened" })
      const result = await handlePullRequestEvent(payload, container)

      expect(result.action).toBe("skipped")
      expect(result.reason).toContain("Repo not ready")
    })
  })
})
