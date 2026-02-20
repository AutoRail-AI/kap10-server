/**
 * OAuth 2.1 Authorization endpoint with PKCE (S256 required).
 * Generates auth codes stored in Redis (TTL 10 min).
 */

import { createHash, randomBytes } from "crypto"
import type { ICacheStore } from "@/lib/ports/cache-store"
import { getClient } from "./dcr"

export interface AuthorizeParams {
  client_id: string
  redirect_uri: string
  code_challenge: string
  code_challenge_method: string
  scope?: string
  state?: string
}

export interface AuthorizeResult {
  redirectUrl: string
}

export interface AuthorizeError {
  error: string
  error_description: string
}

interface StoredAuthCode {
  clientId: string
  redirectUri: string
  codeChallenge: string
  userId: string
  orgId: string
  scope: string
  createdAt: number
}

const AUTH_CODE_TTL = 600 // 10 minutes

/**
 * Validate authorization request parameters.
 */
export async function validateAuthorizeRequest(
  params: AuthorizeParams,
  cacheStore: ICacheStore
): Promise<AuthorizeError | null> {
  // Validate client_id
  if (!params.client_id) {
    return { error: "invalid_request", error_description: "client_id is required" }
  }

  const client = await getClient(params.client_id, cacheStore)
  if (!client) {
    return { error: "invalid_client", error_description: "Unknown or expired client_id" }
  }

  // Validate redirect_uri
  if (!params.redirect_uri) {
    return { error: "invalid_request", error_description: "redirect_uri is required" }
  }
  if (!client.redirect_uris.includes(params.redirect_uri)) {
    return { error: "invalid_request", error_description: "redirect_uri does not match registered URIs" }
  }

  // Require PKCE with S256
  if (!params.code_challenge) {
    return { error: "invalid_request", error_description: "code_challenge is required (PKCE S256)" }
  }
  if (params.code_challenge_method !== "S256") {
    return { error: "invalid_request", error_description: "Only S256 code_challenge_method is supported" }
  }

  return null
}

/**
 * Generate an authorization code after user consent.
 */
export async function generateAuthCode(
  params: AuthorizeParams,
  userId: string,
  orgId: string,
  cacheStore: ICacheStore
): Promise<AuthorizeResult> {
  const code = randomBytes(32).toString("hex")
  const scope = params.scope ?? "mcp:read"

  const storedCode: StoredAuthCode = {
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    userId,
    orgId,
    scope,
    createdAt: Date.now(),
  }

  await cacheStore.set(`oauth:code:${code}`, storedCode, AUTH_CODE_TTL)

  const redirectUrl = new URL(params.redirect_uri)
  redirectUrl.searchParams.set("code", code)
  if (params.state) {
    redirectUrl.searchParams.set("state", params.state)
  }

  return { redirectUrl: redirectUrl.toString() }
}

/**
 * Consume an authorization code (single-use).
 * Verifies PKCE code_verifier against stored code_challenge.
 */
export async function consumeAuthCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
  cacheStore: ICacheStore
): Promise<StoredAuthCode | AuthorizeError> {
  const stored = await cacheStore.get<StoredAuthCode>(`oauth:code:${code}`)
  if (!stored) {
    return { error: "invalid_grant", error_description: "Invalid or expired authorization code" }
  }

  // Invalidate code (single-use)
  await cacheStore.invalidate(`oauth:code:${code}`)

  // Verify client
  if (stored.clientId !== clientId) {
    return { error: "invalid_grant", error_description: "client_id mismatch" }
  }
  if (stored.redirectUri !== redirectUri) {
    return { error: "invalid_grant", error_description: "redirect_uri mismatch" }
  }

  // Verify PKCE
  const challenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url")

  if (challenge !== stored.codeChallenge) {
    return { error: "invalid_grant", error_description: "PKCE verification failed" }
  }

  return stored
}

/**
 * Check if an authorize result is an error.
 */
export function isAuthorizeError(result: AuthorizeResult | AuthorizeError): result is AuthorizeError {
  return "error" in result
}

/**
 * Check if a consumed auth code result is an error.
 */
export function isConsumeError(result: StoredAuthCode | AuthorizeError): result is AuthorizeError {
  return "error" in result
}
