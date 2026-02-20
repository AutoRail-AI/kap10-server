/**
 * Dynamic Client Registration (RFC 7591) for MCP OAuth.
 * Clients register dynamically and receive a client_id stored in Redis with TTL.
 */

import { randomBytes } from "crypto"
import type { ICacheStore } from "@/lib/ports/cache-store"

export interface DcrRequest {
  client_name: string
  redirect_uris: string[]
  grant_types?: string[]
  response_types?: string[]
  token_endpoint_auth_method?: string
}

export interface DcrResponse {
  client_id: string
  client_secret?: string
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: string
  client_id_issued_at: number
  client_secret_expires_at: number
}

export interface DcrError {
  error: string
  error_description: string
}

interface StoredClient {
  client_id: string
  client_secret?: string
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: string
}

const ALLOWED_REDIRECT_PATTERNS = [
  /^http:\/\/localhost(:\d+)?/, // localhost with any port
  /^http:\/\/127\.0\.0\.1(:\d+)?/, // 127.0.0.1 with any port
  /^http:\/\/\[::1\](:\d+)?/, // IPv6 loopback
]

function isValidRedirectUri(uri: string): boolean {
  return ALLOWED_REDIRECT_PATTERNS.some((pattern) => pattern.test(uri))
}

/**
 * Register a new OAuth client dynamically.
 */
export async function registerClient(
  request: DcrRequest,
  cacheStore: ICacheStore
): Promise<DcrResponse | DcrError> {
  // Validate required fields
  if (!request.client_name) {
    return { error: "invalid_client_metadata", error_description: "client_name is required" }
  }
  if (!request.redirect_uris || request.redirect_uris.length === 0) {
    return { error: "invalid_client_metadata", error_description: "redirect_uris is required" }
  }

  // Validate redirect URIs
  for (const uri of request.redirect_uris) {
    if (!isValidRedirectUri(uri)) {
      return {
        error: "invalid_redirect_uri",
        error_description: `Invalid redirect_uri: ${uri}. Only localhost URIs are allowed for dynamic registration.`,
      }
    }
  }

  // Generate client credentials
  const clientId = `dyn_${randomBytes(16).toString("hex")}`
  const authMethod = request.token_endpoint_auth_method ?? "none"
  const clientSecret = authMethod !== "none" ? randomBytes(32).toString("hex") : undefined

  const storedClient: StoredClient = {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: request.client_name,
    redirect_uris: request.redirect_uris,
    grant_types: request.grant_types ?? ["authorization_code"],
    response_types: request.response_types ?? ["code"],
    token_endpoint_auth_method: authMethod,
  }

  // Store in Redis with TTL
  const ttlHours = parseInt(process.env.MCP_OAUTH_DCR_TTL_HOURS ?? "24", 10)
  const ttlSeconds = ttlHours * 3600
  await cacheStore.set(`oauth:client:${clientId}`, storedClient, ttlSeconds)

  const now = Math.floor(Date.now() / 1000)

  return {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: storedClient.client_name,
    redirect_uris: storedClient.redirect_uris,
    grant_types: storedClient.grant_types,
    response_types: storedClient.response_types,
    token_endpoint_auth_method: storedClient.token_endpoint_auth_method,
    client_id_issued_at: now,
    client_secret_expires_at: now + ttlSeconds,
  }
}

/**
 * Look up a registered client by client_id.
 */
export async function getClient(
  clientId: string,
  cacheStore: ICacheStore
): Promise<StoredClient | null> {
  return cacheStore.get<StoredClient>(`oauth:client:${clientId}`)
}

/**
 * Check if a DCR result is an error.
 */
export function isDcrError(result: DcrResponse | DcrError): result is DcrError {
  return "error" in result
}
