import { beforeEach, describe, expect, it, vi } from "vitest"
import { InMemoryCacheStore, InMemoryRelationalStore } from "@/lib/di/fakes"
import {
  authenticateMcpRequest,
  createJwt,
  generateApiKey,
  hashApiKey,
  hasScope,
  isAuthError,
} from "../auth"

describe("hashApiKey", () => {
  it("returns consistent hash for same input", () => {
    const h1 = hashApiKey("unerr_sk_test123")
    const h2 = hashApiKey("unerr_sk_test123")
    expect(h1).toBe(h2)
  })

  it("returns different hashes for different inputs", () => {
    const h1 = hashApiKey("unerr_sk_aaa")
    const h2 = hashApiKey("unerr_sk_bbb")
    expect(h1).not.toBe(h2)
  })

  it("returns a hex string", () => {
    const hash = hashApiKey("unerr_sk_test")
    expect(hash).toMatch(/^[a-f0-9]+$/)
  })
})

describe("generateApiKey", () => {
  it("returns raw, hash, and prefix", () => {
    const key = generateApiKey()
    expect(key.raw).toMatch(/^unerr_sk_/)
    expect(key.prefix).toMatch(/^unerr_sk_/)
    expect(key.prefix).toContain("****")
    expect(key.hash).toMatch(/^[a-f0-9]+$/)
  })

  it("hash matches hashApiKey of raw", () => {
    const key = generateApiKey()
    expect(hashApiKey(key.raw)).toBe(key.hash)
  })

  it("generates unique keys", () => {
    const k1 = generateApiKey()
    const k2 = generateApiKey()
    expect(k1.raw).not.toBe(k2.raw)
  })
})

describe("createJwt", () => {
  it("creates a three-part JWT", () => {
    const token = createJwt(
      { sub: "user1", org: "org1", scope: "mcp:read", aud: "unerr-mcp" },
      "test-secret"
    )
    const parts = token.split(".")
    expect(parts).toHaveLength(3)
  })

  it("encodes correct payload", () => {
    const token = createJwt(
      { sub: "user1", org: "org1", scope: "mcp:read mcp:sync", aud: "unerr-mcp" },
      "test-secret",
      3600
    )
    const payloadB64 = token.split(".")[1]!
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as {
      sub: string
      org: string
      scope: string
      aud: string
      exp: number
      iat: number
    }
    expect(payload.sub).toBe("user1")
    expect(payload.org).toBe("org1")
    expect(payload.scope).toBe("mcp:read mcp:sync")
    expect(payload.aud).toBe("unerr-mcp")
    expect(payload.exp).toBeGreaterThan(payload.iat)
  })
})

describe("authenticateMcpRequest", () => {
  let cache: InMemoryCacheStore
  let relational: InMemoryRelationalStore

  beforeEach(() => {
    cache = new InMemoryCacheStore()
    relational = new InMemoryRelationalStore()
  })

  it("rejects missing Authorization header", async () => {
    const result = await authenticateMcpRequest(null, cache, relational)
    expect(isAuthError(result)).toBe(true)
    if (isAuthError(result)) {
      expect(result.status).toBe(401)
      expect(result.wwwAuthenticate).toContain("Bearer")
    }
  })

  it("rejects non-Bearer header", async () => {
    const result = await authenticateMcpRequest("Basic abc", cache, relational)
    expect(isAuthError(result)).toBe(true)
  })

  it("authenticates valid API key", async () => {
    const key = generateApiKey()
    await relational.createApiKey({
      organizationId: "org-1",
      repoId: "repo-1",
      name: "test-key",
      keyPrefix: key.prefix,
      keyHash: key.hash,
      scopes: ["mcp:read"],
    })

    const result = await authenticateMcpRequest(`Bearer ${key.raw}`, cache, relational)
    expect(isAuthError(result)).toBe(false)
    if (!isAuthError(result)) {
      expect(result.authMode).toBe("api_key")
      expect(result.orgId).toBe("org-1")
      expect(result.repoId).toBe("repo-1")
      expect(result.scopes).toEqual(["mcp:read"])
    }
  })

  it("rejects invalid API key", async () => {
    const result = await authenticateMcpRequest(
      "Bearer unerr_sk_invalidkey",
      cache,
      relational
    )
    expect(isAuthError(result)).toBe(true)
    if (isAuthError(result)) {
      expect(result.status).toBe(401)
    }
  })

  it("rejects revoked API key", async () => {
    const key = generateApiKey()
    const created = await relational.createApiKey({
      organizationId: "org-1",
      repoId: "repo-1",
      name: "test",
      keyPrefix: key.prefix,
      keyHash: key.hash,
      scopes: ["mcp:read"],
    })
    await relational.revokeApiKey(created.id)

    const result = await authenticateMcpRequest(`Bearer ${key.raw}`, cache, relational)
    expect(isAuthError(result)).toBe(true)
  })

  it("authenticates valid JWT", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-jwt-secret")
    vi.stubEnv("MCP_JWT_AUDIENCE", "unerr-mcp")

    const token = createJwt(
      { sub: "user1", org: "org1", scope: "mcp:read mcp:sync", aud: "unerr-mcp" },
      "test-jwt-secret"
    )

    const result = await authenticateMcpRequest(`Bearer ${token}`, cache, relational)
    expect(isAuthError(result)).toBe(false)
    if (!isAuthError(result)) {
      expect(result.authMode).toBe("oauth")
      expect(result.userId).toBe("user1")
      expect(result.orgId).toBe("org1")
      expect(result.scopes).toEqual(["mcp:read", "mcp:sync"])
    }

    vi.unstubAllEnvs()
  })

  it("rejects expired JWT", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-jwt-secret")
    vi.stubEnv("MCP_JWT_AUDIENCE", "unerr-mcp")

    const token = createJwt(
      { sub: "user1", org: "org1", scope: "mcp:read", aud: "unerr-mcp" },
      "test-jwt-secret",
      -10 // already expired
    )

    const result = await authenticateMcpRequest(`Bearer ${token}`, cache, relational)
    expect(isAuthError(result)).toBe(true)

    vi.unstubAllEnvs()
  })

  it("uses cached API key on second request", async () => {
    const key = generateApiKey()
    await relational.createApiKey({
      organizationId: "org-1",
      repoId: "repo-1",
      name: "test",
      keyPrefix: key.prefix,
      keyHash: key.hash,
      scopes: ["mcp:read"],
    })

    // First request: populates cache
    await authenticateMcpRequest(`Bearer ${key.raw}`, cache, relational)

    // Second request: should hit cache
    const result = await authenticateMcpRequest(`Bearer ${key.raw}`, cache, relational)
    expect(isAuthError(result)).toBe(false)
    if (!isAuthError(result)) {
      expect(result.orgId).toBe("org-1")
    }
  })
})

describe("hasScope", () => {
  it("returns true when scope exists", () => {
    expect(
      hasScope(
        { authMode: "api_key", userId: "", orgId: "o", scopes: ["mcp:read", "mcp:sync"] },
        "mcp:read"
      )
    ).toBe(true)
  })

  it("returns false when scope missing", () => {
    expect(
      hasScope(
        { authMode: "api_key", userId: "", orgId: "o", scopes: ["mcp:read"] },
        "mcp:sync"
      )
    ).toBe(false)
  })
})

describe("isAuthError", () => {
  it("detects auth errors", () => {
    expect(isAuthError({ status: 401, message: "nope" })).toBe(true)
  })

  it("detects auth context", () => {
    expect(
      isAuthError({ authMode: "oauth" as const, userId: "u", orgId: "o", scopes: [] })
    ).toBe(false)
  })
})
