/**
 * P5-TEST-04: GitHub webhook push handler.
 * Tests signature verification, push event handling, and incremental indexing trigger.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHmac } from "node:crypto"
import type { Container } from "@/lib/di/container"
import { createTestContainer } from "@/lib/di/container"

vi.mock("@/lib/di/container", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/di/container")>()
  let testContainer: Container | null = null
  return {
    ...original,
    getContainer: () => testContainer ?? original.createTestContainer(),
    __setTestContainer: (c: Container) => {
      testContainer = c
    },
    __resetTestContainer: () => {
      testContainer = null
    },
  }
})

const { __setTestContainer, __resetTestContainer } = await import("@/lib/di/container")
const { POST } = await import("@/app/api/webhooks/github/route")

const WEBHOOK_SECRET = "test-webhook-secret-abc123"

function signPayload(payload: string): string {
  return "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")
}

function makeRequest(
  body: string,
  headers: Record<string, string>
): Request {
  return new Request("http://localhost:3000/api/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  }) as unknown as Request
}

function makePushPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: "refs/heads/main",
    before: "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
    after: "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222",
    repository: {
      id: 12345,
      full_name: "test-org/test-repo",
      default_branch: "main",
      clone_url: "https://github.com/test-org/test-repo.git",
    },
    installation: { id: 999 },
    head_commit: { message: "feat: add new feature" },
    commits: [{ message: "feat: add new feature" }],
    ...overrides,
  }
}

describe("GitHub webhook POST handler", () => {
  let container: Container
  const originalEnv = process.env.GITHUB_WEBHOOK_SECRET

  beforeEach(() => {
    container = createTestContainer()
    __setTestContainer(container)
    process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET
  })

  afterEach(() => {
    __resetTestContainer()
    if (originalEnv !== undefined) {
      process.env.GITHUB_WEBHOOK_SECRET = originalEnv
    } else {
      delete process.env.GITHUB_WEBHOOK_SECRET
    }
  })

  it("returns 401 when x-github-delivery header is missing", async () => {
    const body = JSON.stringify(makePushPayload())
    const req = makeRequest(body, {
      "x-hub-signature-256": signPayload(body),
      "x-github-event": "push",
    })

    const res = await POST(req as never)
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain("Missing headers")
  })

  it("returns 401 when x-hub-signature-256 header is missing", async () => {
    const body = JSON.stringify(makePushPayload())
    const req = makeRequest(body, {
      "x-github-delivery": "delivery-1",
      "x-github-event": "push",
    })

    const res = await POST(req as never)
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain("Missing headers")
  })

  it("returns 401 when signature is invalid", async () => {
    const body = JSON.stringify(makePushPayload())
    const req = makeRequest(body, {
      "x-github-delivery": "delivery-2",
      "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      "x-github-event": "push",
    })

    const res = await POST(req as never)
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain("Invalid signature")
  })

  it("returns 500 when webhook secret is not configured", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET

    const body = JSON.stringify(makePushPayload())
    const req = makeRequest(body, {
      "x-github-delivery": "delivery-3",
      "x-hub-signature-256": signPayload(body),
      "x-github-event": "push",
    })

    const res = await POST(req as never)
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain("not configured")
  })

  it("handles valid push event with correct signature (returns ok)", async () => {
    // Set up installation and repo so handlePushEvent can resolve them
    await container.relationalStore.createInstallation({
      organizationId: "org-1",
      installationId: 999,
      accountLogin: "test-org",
      accountType: "Organization",
    })
    await container.relationalStore.createRepo({
      organizationId: "org-1",
      name: "test-repo",
      fullName: "test-org/test-repo",
      provider: "github",
      providerId: "12345",
      status: "ready",
      githubRepoId: 12345,
    })

    const body = JSON.stringify(makePushPayload())
    const req = makeRequest(body, {
      "x-github-delivery": "delivery-4",
      "x-hub-signature-256": signPayload(body),
      "x-github-event": "push",
    })

    // Track workflow starts
    const startedWorkflows: Array<{ workflowFn: string; workflowId: string }> = []
    container.workflowEngine.startWorkflow = async (opts: { workflowFn?: string; workflowId?: string } = {}) => {
      startedWorkflows.push({ workflowFn: opts.workflowFn ?? "", workflowId: opts.workflowId ?? "" })
      return { workflowId: opts.workflowId ?? "test", runId: "run-1", result: async () => undefined as never }
    }

    const res = await POST(req as never)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean }
    expect(json.ok).toBe(true)

    // Verify an incremental index workflow was triggered
    expect(startedWorkflows.length).toBeGreaterThanOrEqual(1)
    const incrementalWf = startedWorkflows.find((w) => w.workflowFn === "incrementalIndexWorkflow")
    expect(incrementalWf).toBeDefined()
    expect(incrementalWf!.workflowId).toContain("incremental-")
  })

  it("handles non-push events gracefully", async () => {
    const body = JSON.stringify({ action: "opened", installation: { id: 999 } })
    const req = makeRequest(body, {
      "x-github-delivery": "delivery-5",
      "x-hub-signature-256": signPayload(body),
      "x-github-event": "pull_request",
    })

    const res = await POST(req as never)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean }
    expect(json.ok).toBe(true)
  })

  it("handles push event with missing installation gracefully", async () => {
    const payload = makePushPayload()
    delete payload.installation
    const body = JSON.stringify(payload)

    const req = makeRequest(body, {
      "x-github-delivery": "delivery-6",
      "x-hub-signature-256": signPayload(body),
      "x-github-event": "push",
    })

    const res = await POST(req as never)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean }
    expect(json.ok).toBe(true)
  })

  it("deduplicates webhook deliveries with the same delivery ID", async () => {
    const body = JSON.stringify(makePushPayload())
    const headers = {
      "x-github-delivery": "delivery-dedupe",
      "x-hub-signature-256": signPayload(body),
      "x-github-event": "push",
    }

    const res1 = await POST(makeRequest(body, headers) as never)
    expect(res1.status).toBe(200)

    // Second call with same delivery ID should be deduped (still returns ok)
    const res2 = await POST(makeRequest(body, headers) as never)
    expect(res2.status).toBe(200)
  })

  it("skips push to non-default branch", async () => {
    await container.relationalStore.createInstallation({
      organizationId: "org-1",
      installationId: 999,
      accountLogin: "test-org",
      accountType: "Organization",
    })
    await container.relationalStore.createRepo({
      organizationId: "org-1",
      name: "test-repo",
      fullName: "test-org/test-repo",
      provider: "github",
      providerId: "12345",
      status: "ready",
      githubRepoId: 12345,
    })

    const payload = makePushPayload({ ref: "refs/heads/feature-branch" })
    const body = JSON.stringify(payload)

    const startedWorkflows: string[] = []
    container.workflowEngine.startWorkflow = async (opts: { workflowFn?: string } = {}) => {
      startedWorkflows.push(opts.workflowFn ?? "")
      return { workflowId: "test", runId: "run-1", result: async () => undefined as never }
    }

    const req = makeRequest(body, {
      "x-github-delivery": "delivery-branch",
      "x-hub-signature-256": signPayload(body),
      "x-github-event": "push",
    })

    const res = await POST(req as never)
    expect(res.status).toBe(200)
    // No incremental workflow should be triggered for non-default branch
    expect(startedWorkflows.filter((wf) => wf === "incrementalIndexWorkflow")).toHaveLength(0)
  })
})
