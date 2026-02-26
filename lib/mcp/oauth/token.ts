/**
 * OAuth 2.1 Token endpoint.
 * Supports grant_type=authorization_code (initial) and grant_type=refresh_token (refresh).
 * Mints JWT tokens signed with BETTER_AUTH_SECRET (HMAC-SHA256).
 */

import { randomBytes } from "crypto"
import type { ICacheStore } from "@/lib/ports/cache-store"
import { consumeAuthCode, isConsumeError } from "./authorize"
import { createJwt } from "../auth"

export interface TokenRequest {
  grant_type: string
  code?: string
  code_verifier?: string
  client_id: string
  redirect_uri?: string
  refresh_token?: string
}

export interface TokenResponse {
  access_token: string
  token_type: "Bearer"
  expires_in: number
  refresh_token: string
  scope: string
}

export interface TokenError {
  error: string
  error_description: string
}

interface StoredRefreshToken {
  userId: string
  orgId: string
  scope: string
  clientId: string
  createdAt: number
}

const ACCESS_TOKEN_EXPIRY = 3600 // 1 hour
const REFRESH_TOKEN_TTL = 30 * 24 * 3600 // 30 days

/**
 * Handle a token request (authorization_code or refresh_token grant).
 */
export async function handleTokenRequest(
  request: TokenRequest,
  cacheStore: ICacheStore
): Promise<TokenResponse | TokenError> {
  switch (request.grant_type) {
    case "authorization_code":
      return handleAuthCodeGrant(request, cacheStore)
    case "refresh_token":
      return handleRefreshGrant(request, cacheStore)
    default:
      return { error: "unsupported_grant_type", error_description: `Unsupported grant_type: ${request.grant_type}` }
  }
}

async function handleAuthCodeGrant(
  request: TokenRequest,
  cacheStore: ICacheStore
): Promise<TokenResponse | TokenError> {
  if (!request.code) {
    return { error: "invalid_request", error_description: "code is required" }
  }
  if (!request.code_verifier) {
    return { error: "invalid_request", error_description: "code_verifier is required (PKCE)" }
  }
  if (!request.redirect_uri) {
    return { error: "invalid_request", error_description: "redirect_uri is required" }
  }

  const result = await consumeAuthCode(
    request.code,
    request.code_verifier,
    request.client_id,
    request.redirect_uri,
    cacheStore
  )

  if (isConsumeError(result)) {
    return { error: result.error, error_description: result.error_description }
  }

  return mintTokens(result.userId, result.orgId, result.scope, request.client_id, cacheStore)
}

async function handleRefreshGrant(
  request: TokenRequest,
  cacheStore: ICacheStore
): Promise<TokenResponse | TokenError> {
  if (!request.refresh_token) {
    return { error: "invalid_request", error_description: "refresh_token is required" }
  }

  const stored = await cacheStore.get<StoredRefreshToken>(`oauth:refresh:${request.refresh_token}`)
  if (!stored) {
    return { error: "invalid_grant", error_description: "Invalid or expired refresh token" }
  }

  // Invalidate old refresh token (rotation)
  await cacheStore.invalidate(`oauth:refresh:${request.refresh_token}`)

  // Verify client
  if (stored.clientId !== request.client_id) {
    return { error: "invalid_grant", error_description: "client_id mismatch" }
  }

  return mintTokens(stored.userId, stored.orgId, stored.scope, request.client_id, cacheStore)
}

async function mintTokens(
  userId: string,
  orgId: string,
  scope: string,
  clientId: string,
  cacheStore: ICacheStore
): Promise<TokenResponse | TokenError> {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    return { error: "server_error", error_description: "Server configuration error" }
  }

  const audience = process.env.MCP_JWT_AUDIENCE ?? "unerr-mcp"

  // Mint access token (JWT)
  const accessToken = createJwt(
    { sub: userId, org: orgId, scope, aud: audience },
    secret,
    ACCESS_TOKEN_EXPIRY
  )

  // Generate refresh token
  const refreshToken = randomBytes(32).toString("hex")
  const storedRefresh: StoredRefreshToken = {
    userId,
    orgId,
    scope,
    clientId,
    createdAt: Date.now(),
  }
  await cacheStore.set(`oauth:refresh:${refreshToken}`, storedRefresh, REFRESH_TOKEN_TTL)

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_EXPIRY,
    refresh_token: refreshToken,
    scope,
  }
}

/**
 * Check if a token result is an error.
 */
export function isTokenError(result: TokenResponse | TokenError): result is TokenError {
  return "error" in result
}
