/**
 * Phase 2: Device Authorization Flow — End-to-End Tests
 *
 * Tests the full RFC 8628 device auth flow:
 *   POST /api/cli/device-code → browser approve → POST /api/cli/token
 * Plus the context lookup endpoint:
 *   GET /api/cli/context
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTestContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"

// ── Mock DI container ────────────────────────────────────────

let testContainer: Container

vi.mock("@/lib/di/container", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/di/container")>()
  return {
    ...original,
    getContainer: () => testContainer,
  }
})

// ── Import route handlers after mocks ────────────────────────

const { POST: deviceCodePOST } = await import("../device-code/route")
const { POST: tokenPOST } = await import("../token/route")
const { GET: contextGET } = await import("../context/route")

// ── Helpers ──────────────────────────────────────────────────

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

// ── Tests ────────────────────────────────────────────────────

describe("POST /api/cli/device-code", () => {
  beforeEach(() => {
    testContainer = createTestContainer()
  })

  it("returns device_code, user_code, verification_uri, expires_in, interval", async () => {
    const res = await deviceCodePOST()
    expect(res.status).toBe(200)

    const data = await json<{
      device_code: string
      user_code: string
      verification_uri: string
      expires_in: number
      interval: number
    }>(res)

    expect(data.device_code).toBeTruthy()
    expect(data.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(data.verification_uri).toContain("/cli/authorize")
    expect(data.expires_in).toBe(600)
    expect(data.interval).toBe(5)
  })

  it("stores device state and reverse lookup in cache", async () => {
    const res = await deviceCodePOST()
    const data = await json<{ device_code: string; user_code: string }>(res)

    // Check device state
    const deviceState = await testContainer.cacheStore.get<{
      userCode: string
      status: string
    }>(`cli:device:${data.device_code}`)
    expect(deviceState).not.toBeNull()
    expect(deviceState!.userCode).toBe(data.user_code)
    expect(deviceState!.status).toBe("pending")

    // Check reverse lookup
    const reverseLookup = await testContainer.cacheStore.get<string>(
      `cli:usercode:${data.user_code}`
    )
    expect(reverseLookup).toBe(data.device_code)
  })

  it("generates unique codes on each call", async () => {
    const res1 = await deviceCodePOST()
    const res2 = await deviceCodePOST()

    const data1 = await json<{ device_code: string; user_code: string }>(res1)
    const data2 = await json<{ device_code: string; user_code: string }>(res2)

    expect(data1.device_code).not.toBe(data2.device_code)
    expect(data1.user_code).not.toBe(data2.user_code)
  })
})

describe("POST /api/cli/token", () => {
  beforeEach(() => {
    testContainer = createTestContainer()
  })

  it("rejects unsupported grant_type", async () => {
    const req = jsonRequest("http://localhost/api/cli/token", {
      device_code: "abc",
      grant_type: "authorization_code",
    })
    const res = await tokenPOST(req)
    expect(res.status).toBe(400)

    const data = await json<{ error: string }>(res)
    expect(data.error).toBe("unsupported_grant_type")
  })

  it("rejects missing device_code", async () => {
    const req = jsonRequest("http://localhost/api/cli/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
    const res = await tokenPOST(req)
    expect(res.status).toBe(400)

    const data = await json<{ error: string }>(res)
    expect(data.error).toBe("invalid_request")
  })

  it("returns expired_token for unknown device_code", async () => {
    const req = jsonRequest("http://localhost/api/cli/token", {
      device_code: "nonexistent",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
    const res = await tokenPOST(req)
    expect(res.status).toBe(400)

    const data = await json<{ error: string }>(res)
    expect(data.error).toBe("expired_token")
  })

  it("returns authorization_pending when device is pending", async () => {
    // Seed a pending device code
    await testContainer.cacheStore.set("cli:device:test-device-code", {
      userCode: "ABCD-EFGH",
      status: "pending",
      createdAt: Date.now(),
    }, 600)

    const req = jsonRequest("http://localhost/api/cli/token", {
      device_code: "test-device-code",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
    const res = await tokenPOST(req)
    expect(res.status).toBe(400)

    const data = await json<{ error: string }>(res)
    expect(data.error).toBe("authorization_pending")
  })

  it("returns access_token when device is approved (first time — creates default key)", async () => {
    // Seed an approved device code
    await testContainer.cacheStore.set("cli:device:approved-code", {
      userCode: "WXYZ-1234",
      status: "approved",
      createdAt: Date.now(),
      userId: "user-1",
      orgId: "org-1",
      orgName: "Test Org",
    }, 600)
    await testContainer.cacheStore.set("cli:usercode:WXYZ-1234", "approved-code", 600)

    const req = jsonRequest("http://localhost/api/cli/token", {
      device_code: "approved-code",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
    const res = await tokenPOST(req)
    expect(res.status).toBe(200)

    const data = await json<{
      access_token: string
      token_type: string
      org_id: string
      org_name: string
      server_url: string
      key_already_existed: boolean
    }>(res)

    expect(data.access_token).toMatch(/^unerr_sk_/)
    expect(data.token_type).toBe("Bearer")
    expect(data.org_id).toBe("org-1")
    expect(data.org_name).toBe("Test Org")
    expect(data.key_already_existed).toBe(false)

    // Verify default key was created in the relational store
    const defaultKey = await testContainer.relationalStore.getDefaultApiKey("org-1")
    expect(defaultKey).not.toBeNull()
    expect(defaultKey!.isDefault).toBe(true)
    expect(defaultKey!.name).toBe("Default CLI Key")
    expect(defaultKey!.repoId).toBeNull()
    expect(defaultKey!.scopes).toEqual(["mcp:read", "mcp:sync"])
  })

  it("returns key_already_existed=true when default key exists", async () => {
    // Pre-create a default key
    await testContainer.relationalStore.createApiKey({
      organizationId: "org-2",
      name: "Default CLI Key",
      keyPrefix: "unerr_sk_xxxx****",
      keyHash: "somehash",
      scopes: ["mcp:read", "mcp:sync"],
      isDefault: true,
    })

    // Seed an approved device code
    await testContainer.cacheStore.set("cli:device:approved-code-2", {
      userCode: "TEST-5678",
      status: "approved",
      createdAt: Date.now(),
      userId: "user-2",
      orgId: "org-2",
      orgName: "Org Two",
    }, 600)

    const req = jsonRequest("http://localhost/api/cli/token", {
      device_code: "approved-code-2",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
    const res = await tokenPOST(req)
    expect(res.status).toBe(200)

    const data = await json<{ key_already_existed: boolean }>(res)
    expect(data.key_already_existed).toBe(true)
  })

  it("cleans up Redis entries after successful exchange", async () => {
    await testContainer.cacheStore.set("cli:device:cleanup-code", {
      userCode: "CLEN-UP99",
      status: "approved",
      createdAt: Date.now(),
      userId: "user-1",
      orgId: "org-cleanup",
      orgName: "Cleanup Org",
    }, 600)
    await testContainer.cacheStore.set("cli:usercode:CLEN-UP99", "cleanup-code", 600)

    const req = jsonRequest("http://localhost/api/cli/token", {
      device_code: "cleanup-code",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
    await tokenPOST(req)

    // Both keys should be cleaned up
    const deviceState = await testContainer.cacheStore.get("cli:device:cleanup-code")
    const reverseState = await testContainer.cacheStore.get("cli:usercode:CLEN-UP99")
    expect(deviceState).toBeNull()
    expect(reverseState).toBeNull()
  })
})

describe("POST /api/cli/token — full device flow integration", () => {
  beforeEach(() => {
    testContainer = createTestContainer()
  })

  it("device-code → pending → approve → token (end-to-end)", async () => {
    // Step 1: Generate device code
    const dcRes = await deviceCodePOST()
    const dcData = await json<{ device_code: string; user_code: string }>(dcRes)

    // Step 2: Poll — should be pending
    const pendingReq = jsonRequest("http://localhost/api/cli/token", {
      device_code: dcData.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
    const pendingRes = await tokenPOST(pendingReq)
    expect(pendingRes.status).toBe(400)
    expect((await json<{ error: string }>(pendingRes)).error).toBe("authorization_pending")

    // Step 3: Simulate browser approval (what the server action does)
    await testContainer.cacheStore.set(`cli:device:${dcData.device_code}`, {
      userCode: dcData.user_code,
      status: "approved",
      createdAt: Date.now(),
      userId: "user-e2e",
      orgId: "org-e2e",
      orgName: "E2E Org",
    }, 600)

    // Step 4: Poll again — should get token
    const tokenReq = jsonRequest("http://localhost/api/cli/token", {
      device_code: dcData.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
    const tokenRes = await tokenPOST(tokenReq)
    expect(tokenRes.status).toBe(200)

    const tokenData = await json<{
      access_token: string
      org_id: string
      org_name: string
      key_already_existed: boolean
    }>(tokenRes)

    expect(tokenData.access_token).toMatch(/^unerr_sk_/)
    expect(tokenData.org_id).toBe("org-e2e")
    expect(tokenData.org_name).toBe("E2E Org")
    expect(tokenData.key_already_existed).toBe(false)

    // Step 5: Polling again should fail (cleaned up)
    const replayReq = jsonRequest("http://localhost/api/cli/token", {
      device_code: dcData.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
    const replayRes = await tokenPOST(replayReq)
    expect(replayRes.status).toBe(400)
    expect((await json<{ error: string }>(replayRes)).error).toBe("expired_token")
  })
})

describe("GET /api/cli/context", () => {
  beforeEach(() => {
    testContainer = createTestContainer()
  })

  it("rejects requests without auth header", async () => {
    const req = new Request("http://localhost/api/cli/context?remote=github.com/org/repo")
    const res = await contextGET(req)
    expect(res.status).toBe(401)
  })

  it("rejects requests with invalid API key", async () => {
    const req = new Request("http://localhost/api/cli/context?remote=github.com/org/repo", {
      headers: { Authorization: "Bearer unerr_sk_invalid" },
    })
    const res = await contextGET(req)
    expect(res.status).toBe(401)

    const data = await json<{ error: string }>(res)
    expect(data.error).toBe("Invalid API key")
  })

  it("rejects requests without remote param", async () => {
    // Create a valid API key first
    const { hash } = await seedApiKey("org-ctx", testContainer)

    const req = new Request("http://localhost/api/cli/context", {
      headers: { Authorization: `Bearer placeholder` },
    })
    // We need to use the real key, but authenticateMcpRequest hashes the raw key
    // Let's seed the cache directly for simplicity
    await testContainer.cacheStore.set(`mcp:apikey:${hash}`, {
      id: "key-1",
      orgId: "org-ctx",
      repoId: null,
      scopes: ["mcp:read"],
    }, 300)

    // Use raw key
    const rawKey = `unerr_sk_test_context_key`
    const { hashApiKey } = await import("@/lib/mcp/auth")
    const keyHash = hashApiKey(rawKey)
    await testContainer.cacheStore.set(`mcp:apikey:${keyHash}`, {
      id: "key-1",
      orgId: "org-ctx",
      repoId: null,
      scopes: ["mcp:read"],
    }, 300)

    const req2 = new Request("http://localhost/api/cli/context", {
      headers: { Authorization: `Bearer ${rawKey}` },
    })
    const res = await contextGET(req2)
    expect(res.status).toBe(400)

    const data = await json<{ error: string }>(res)
    expect(data.error).toBe("remote query parameter is required")
  })

  it("returns 400 for unparseable remote URL", async () => {
    const rawKey = `unerr_sk_test_parse_key`
    const { hashApiKey } = await import("@/lib/mcp/auth")
    const keyHash = hashApiKey(rawKey)
    await testContainer.cacheStore.set(`mcp:apikey:${keyHash}`, {
      id: "key-2",
      orgId: "org-parse",
      repoId: null,
      scopes: ["mcp:read"],
    }, 300)

    const req = new Request("http://localhost/api/cli/context?remote=not-a-url", {
      headers: { Authorization: `Bearer ${rawKey}` },
    })
    const res = await contextGET(req)
    expect(res.status).toBe(400)

    const data = await json<{ error: string }>(res)
    expect(data.error).toBe("Could not parse remote URL")
  })

  it("returns 404 when repo is not found", async () => {
    const rawKey = `unerr_sk_test_notfound_key`
    const { hashApiKey } = await import("@/lib/mcp/auth")
    const keyHash = hashApiKey(rawKey)
    await testContainer.cacheStore.set(`mcp:apikey:${keyHash}`, {
      id: "key-3",
      orgId: "org-nf",
      repoId: null,
      scopes: ["mcp:read"],
    }, 300)

    const req = new Request(
      "http://localhost/api/cli/context?remote=https://github.com/org/nonexistent.git",
      { headers: { Authorization: `Bearer ${rawKey}` } }
    )
    const res = await contextGET(req)
    expect(res.status).toBe(404)

    const data = await json<{ error: string }>(res)
    expect(data.error).toBe("Repository not found")
  })

  it("returns repo info for HTTPS remote", async () => {
    const orgId = "org-https"
    const rawKey = `unerr_sk_test_https_key`
    const { hashApiKey } = await import("@/lib/mcp/auth")
    const keyHash = hashApiKey(rawKey)
    await testContainer.cacheStore.set(`mcp:apikey:${keyHash}`, {
      id: "key-4",
      orgId,
      repoId: null,
      scopes: ["mcp:read"],
    }, 300)

    // Seed a repo
    await testContainer.relationalStore.createRepo({
      organizationId: orgId,
      name: "my-app",
      fullName: "myorg/my-app",
      provider: "github",
      providerId: "12345",
      status: "ready",
      defaultBranch: "main",
    })

    const req = new Request(
      "http://localhost/api/cli/context?remote=https://github.com/myorg/my-app.git",
      { headers: { Authorization: `Bearer ${rawKey}` } }
    )
    const res = await contextGET(req)
    expect(res.status).toBe(200)

    const data = await json<{
      repoId: string
      repoName: string
      status: string
      indexed: boolean
      defaultBranch: string
    }>(res)

    expect(data.repoName).toBe("myorg/my-app")
    expect(data.status).toBe("ready")
    expect(data.indexed).toBe(true)
    expect(data.defaultBranch).toBe("main")
    expect(data.repoId).toBeTruthy()
  })

  it("returns repo info for SSH remote", async () => {
    const orgId = "org-ssh"
    const rawKey = `unerr_sk_test_ssh_key`
    const { hashApiKey } = await import("@/lib/mcp/auth")
    const keyHash = hashApiKey(rawKey)
    await testContainer.cacheStore.set(`mcp:apikey:${keyHash}`, {
      id: "key-5",
      orgId,
      repoId: null,
      scopes: ["mcp:read"],
    }, 300)

    await testContainer.relationalStore.createRepo({
      organizationId: orgId,
      name: "backend",
      fullName: "company/backend",
      provider: "github",
      providerId: "67890",
      status: "indexing",
      defaultBranch: "develop",
    })

    const req = new Request(
      "http://localhost/api/cli/context?remote=git@github.com:company/backend.git",
      { headers: { Authorization: `Bearer ${rawKey}` } }
    )
    const res = await contextGET(req)
    expect(res.status).toBe(200)

    const data = await json<{
      repoName: string
      status: string
      indexed: boolean
    }>(res)

    expect(data.repoName).toBe("company/backend")
    expect(data.status).toBe("indexing")
    expect(data.indexed).toBe(false)
  })

  it("matches case-insensitively", async () => {
    const orgId = "org-case"
    const rawKey = `unerr_sk_test_case_key`
    const { hashApiKey } = await import("@/lib/mcp/auth")
    const keyHash = hashApiKey(rawKey)
    await testContainer.cacheStore.set(`mcp:apikey:${keyHash}`, {
      id: "key-6",
      orgId,
      repoId: null,
      scopes: ["mcp:read"],
    }, 300)

    await testContainer.relationalStore.createRepo({
      organizationId: orgId,
      name: "MyApp",
      fullName: "MyOrg/MyApp",
      provider: "github",
      providerId: "99999",
      status: "ready",
      defaultBranch: "main",
    })

    const req = new Request(
      "http://localhost/api/cli/context?remote=https://github.com/myorg/myapp.git",
      { headers: { Authorization: `Bearer ${rawKey}` } }
    )
    const res = await contextGET(req)
    expect(res.status).toBe(200)

    const data = await json<{ repoName: string }>(res)
    expect(data.repoName).toBe("MyOrg/MyApp")
  })

  it("matches bare domain remote (no protocol)", async () => {
    const orgId = "org-bare"
    const rawKey = `unerr_sk_test_bare_key`
    const { hashApiKey } = await import("@/lib/mcp/auth")
    const keyHash = hashApiKey(rawKey)
    await testContainer.cacheStore.set(`mcp:apikey:${keyHash}`, {
      id: "key-7",
      orgId,
      repoId: null,
      scopes: ["mcp:read"],
    }, 300)

    await testContainer.relationalStore.createRepo({
      organizationId: orgId,
      name: "tool",
      fullName: "dev/tool",
      provider: "github",
      providerId: "11111",
      status: "ready",
      defaultBranch: "main",
    })

    const req = new Request(
      "http://localhost/api/cli/context?remote=github.com/dev/tool",
      { headers: { Authorization: `Bearer ${rawKey}` } }
    )
    const res = await contextGET(req)
    expect(res.status).toBe(200)
  })
})

// ── Helpers ──────────────────────────────────────────────────

async function seedApiKey(orgId: string, container: Container) {
  const { generateApiKey, hashApiKey } = await import("@/lib/mcp/auth")
  const { raw, hash, prefix } = generateApiKey()
  await container.relationalStore.createApiKey({
    organizationId: orgId,
    name: "test-key",
    keyPrefix: prefix,
    keyHash: hash,
    scopes: ["mcp:read"],
    isDefault: true,
  })
  return { raw, hash, prefix, hashApiKey }
}
