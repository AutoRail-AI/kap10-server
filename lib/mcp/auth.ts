/**
 * Dual-mode MCP authentication middleware.
 *
 * Mode A (OAuth JWT): Token does NOT start with "kap10_sk_" → validate JWT
 *   - HMAC-SHA256 with BETTER_AUTH_SECRET
 *   - Check exp, aud (MCP_JWT_AUDIENCE), extract sub (userId), org (orgId), scope
 *
 * Mode B (API Key): Token starts with "kap10_sk_" → hash lookup
 *   - SHA-256 hash → Redis cache (TTL 5 min) → fallback to Supabase
 *   - Timing-safe comparison for hash lookup
 */

import { createHmac, timingSafeEqual } from "crypto"
import type { ICacheStore } from "@/lib/ports/cache-store"
import type { IRelationalStore } from "@/lib/ports/relational-store"

export interface McpAuthContext {
  authMode: "oauth" | "api_key"
  userId: string
  orgId: string
  repoId?: string
  scopes: string[]
  apiKeyId?: string
  workspaceId?: string
}

export interface AuthError {
  status: number
  message: string
  wwwAuthenticate?: string
}

const API_KEY_PREFIX = "kap10_sk_"
const API_KEY_CACHE_TTL = 300 // 5 minutes

/**
 * Hash an API key using SHA-256 (same as storage).
 */
export function hashApiKey(rawKey: string): string {
  return createHmac("sha256", "kap10-api-key-salt")
    .update(rawKey)
    .digest("hex")
}

/**
 * Generate a new API key with the kap10_sk_ prefix.
 * Returns { raw, hash, prefix } — raw is shown once, hash is stored.
 */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const crypto = require("crypto") as typeof import("crypto")
  const randomPart = crypto.randomBytes(32).toString("base64url")
  const raw = `${API_KEY_PREFIX}${randomPart}`
  const hash = hashApiKey(raw)
  const prefix = `${API_KEY_PREFIX}${randomPart.slice(0, 4)}****`
  return { raw, hash, prefix }
}

/**
 * Decode and verify a JWT token (HMAC-SHA256).
 */
function verifyJwt(
  token: string,
  secret: string,
  audience: string
): { sub: string; org: string; scope: string; exp: number } | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string]

    // Verify signature
    const data = `${headerB64}.${payloadB64}`
    const expectedSig = createHmac("sha256", secret)
      .update(data)
      .digest("base64url")

    // Timing-safe comparison
    const sigBuf = Buffer.from(signatureB64, "base64url")
    const expectedBuf = Buffer.from(expectedSig, "base64url")
    if (sigBuf.length !== expectedBuf.length) return null
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as {
      sub?: string
      org?: string
      scope?: string
      exp?: number
      aud?: string
    }

    // Check expiry
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null

    // Check audience
    if (payload.aud !== audience) return null

    // Check required fields
    if (!payload.sub || !payload.org) return null

    return {
      sub: payload.sub,
      org: payload.org,
      scope: payload.scope ?? "mcp:read",
      exp: payload.exp,
    }
  } catch {
    return null
  }
}

/**
 * Create a JWT token (for OAuth token endpoint).
 */
export function createJwt(
  payload: { sub: string; org: string; scope: string; aud: string },
  secret: string,
  expiresInSeconds = 3600
): string {
  const header = { alg: "HS256", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  }

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url")
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString("base64url")
  const data = `${headerB64}.${payloadB64}`
  const signature = createHmac("sha256", secret).update(data).digest("base64url")

  return `${data}.${signature}`
}

/**
 * Authenticate an MCP request.
 * Returns auth context on success or auth error on failure.
 */
export async function authenticateMcpRequest(
  authHeader: string | null,
  cacheStore: ICacheStore,
  relationalStore: IRelationalStore
): Promise<McpAuthContext | AuthError> {
  const mcpServerUrl = process.env.MCP_SERVER_URL ?? "https://mcp.kap10.dev"

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      status: 401,
      message: "Missing or invalid Authorization header",
      wwwAuthenticate: `Bearer resource_metadata="${mcpServerUrl}/.well-known/oauth-protected-resource"`,
    }
  }

  const token = authHeader.slice(7) // Remove "Bearer "

  // Mode B: API Key
  if (token.startsWith(API_KEY_PREFIX)) {
    return authenticateApiKey(token, cacheStore, relationalStore)
  }

  // Mode A: OAuth JWT
  return authenticateJwt(token)
}

async function authenticateApiKey(
  rawKey: string,
  cacheStore: ICacheStore,
  relationalStore: IRelationalStore
): Promise<McpAuthContext | AuthError> {
  const keyHash = hashApiKey(rawKey)

  // Check Redis cache first
  const cacheKey = `mcp:apikey:${keyHash}`
  const cached = await cacheStore.get<{
    id: string
    orgId: string
    repoId: string | null
    scopes: string[]
  }>(cacheKey)

  if (cached) {
    // Fire-and-forget lastUsed update
    void relationalStore.updateApiKeyLastUsed(cached.id).catch(() => {})
    return {
      authMode: "api_key",
      userId: "", // API keys don't have a user context
      orgId: cached.orgId,
      repoId: cached.repoId ?? undefined,
      scopes: cached.scopes,
      apiKeyId: cached.id,
    }
  }

  // Fallback to database
  const apiKey = await relationalStore.getApiKeyByHash(keyHash)
  if (!apiKey) {
    return { status: 401, message: "Invalid API key" }
  }
  if (apiKey.revokedAt) {
    return { status: 401, message: "API key has been revoked" }
  }

  // Cache the result
  await cacheStore.set(
    cacheKey,
    {
      id: apiKey.id,
      orgId: apiKey.organizationId,
      repoId: apiKey.repoId,
      scopes: apiKey.scopes,
    },
    API_KEY_CACHE_TTL
  )

  // Fire-and-forget lastUsed update
  void relationalStore.updateApiKeyLastUsed(apiKey.id).catch(() => {})

  return {
    authMode: "api_key",
    userId: "",
    orgId: apiKey.organizationId,
    repoId: apiKey.repoId ?? undefined,
    scopes: apiKey.scopes,
    apiKeyId: apiKey.id,
  }
}

function authenticateJwt(token: string): McpAuthContext | AuthError {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    return { status: 500, message: "Server configuration error: missing auth secret" }
  }

  const audience = process.env.MCP_JWT_AUDIENCE ?? "kap10-mcp"
  const payload = verifyJwt(token, secret, audience)

  if (!payload) {
    return { status: 401, message: "Invalid or expired JWT token" }
  }

  const scopes = payload.scope.split(" ").filter(Boolean)

  return {
    authMode: "oauth",
    userId: payload.sub,
    orgId: payload.org,
    scopes,
  }
}

/**
 * Check if the auth context has the required scope for a tool.
 */
export function hasScope(ctx: McpAuthContext, requiredScope: string): boolean {
  return ctx.scopes.includes(requiredScope)
}

/**
 * Check if auth result is an error.
 */
export function isAuthError(result: McpAuthContext | AuthError): result is AuthError {
  return "status" in result && typeof (result as AuthError).status === "number"
}
