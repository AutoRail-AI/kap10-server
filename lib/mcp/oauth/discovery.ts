/**
 * OAuth 2.1 discovery endpoints for MCP.
 * RFC 9728 — Protected Resource Metadata
 * RFC 8414 — Authorization Server Metadata
 */

function getServerUrl(): string {
  return process.env.MCP_SERVER_URL ?? "https://mcp.kap10.dev"
}

/**
 * RFC 9728: Protected Resource Metadata.
 * GET /.well-known/oauth-protected-resource
 */
export function getProtectedResourceMetadata(): Record<string, unknown> {
  const serverUrl = getServerUrl()
  return {
    resource: `${serverUrl}/mcp`,
    authorization_servers: [serverUrl],
    scopes_supported: ["mcp:read", "mcp:sync"],
    bearer_methods_supported: ["header"],
  }
}

/**
 * RFC 8414: Authorization Server Metadata.
 * GET /.well-known/oauth-authorization-server
 */
export function getAuthorizationServerMetadata(): Record<string, unknown> {
  const serverUrl = getServerUrl()
  return {
    issuer: serverUrl,
    authorization_endpoint: `${serverUrl}/oauth/authorize`,
    token_endpoint: `${serverUrl}/oauth/token`,
    registration_endpoint: `${serverUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp:read", "mcp:sync"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  }
}
