/**
 * MCP Streamable HTTP Transport (2025-03-26 spec).
 * Single endpoint: POST /mcp for tool calls (returns JSON or SSE).
 * Optional: GET /mcp for server notifications via SSE.
 *
 * Session management via Mcp-Session-Id header.
 */

import { randomUUID } from "crypto"
import type { IncomingMessage, ServerResponse } from "http"
import { getContainer } from "@/lib/di/container"
import { authenticateMcpRequest, isAuthError, type McpAuthContext } from "./auth"
import { type DcrRequest, isDcrError, registerClient } from "./oauth/dcr"
import { getAuthorizationServerMetadata, getProtectedResourceMetadata } from "./oauth/discovery"
import { handleTokenRequest, isTokenError, type TokenRequest } from "./oauth/token"
import { checkRateLimit, formatRateLimitError } from "./security/rate-limiter"
import { scrubMCPPayload } from "./security/scrubber"
import { handleMcpRequest } from "./server"

const SESSION_TTL = 3600 // 1 hour

/**
 * Parse JSON body from IncomingMessage.
 */
function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8")
        resolve(JSON.parse(body) as Record<string, unknown>)
      } catch (err: unknown) {
        reject(err)
      }
    })
    req.on("error", reject)
  })
}

/**
 * Handle an HTTP request to the MCP server.
 * Routes: POST /mcp, GET /mcp, well-known endpoints, OAuth endpoints.
 */
export async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  const method = req.method?.toUpperCase() ?? "GET"
  const pathname = url.pathname

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id")
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, X-RateLimit-Remaining")

  if (method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    // ── Well-known endpoints ──────────────────────────────
    if (pathname === "/.well-known/oauth-protected-resource" && method === "GET") {
      sendJson(res, 200, getProtectedResourceMetadata())
      return
    }
    if (pathname === "/.well-known/oauth-authorization-server" && method === "GET") {
      sendJson(res, 200, getAuthorizationServerMetadata())
      return
    }

    // ── OAuth endpoints ───────────────────────────────────
    if (pathname === "/oauth/register" && method === "POST") {
      const body = await parseBody(req)
      const container = getContainer()
      const result = await registerClient(body as unknown as DcrRequest, container.cacheStore)
      if (isDcrError(result)) {
        sendJson(res, 400, result)
      } else {
        sendJson(res, 201, result)
      }
      return
    }

    if (pathname === "/oauth/token" && method === "POST") {
      const body = await parseBody(req)
      const container = getContainer()
      const result = await handleTokenRequest(body as unknown as TokenRequest, container.cacheStore)
      if (isTokenError(result)) {
        sendJson(res, 400, result)
      } else {
        sendJson(res, 200, result)
      }
      return
    }

    // ── Health check ──────────────────────────────────────
    if (pathname === "/health" && method === "GET") {
      sendJson(res, 200, { status: "ok", timestamp: new Date().toISOString() })
      return
    }

    // ── MCP endpoint ──────────────────────────────────────
    if (pathname === "/mcp") {
      const container = getContainer()
      const authHeader = req.headers.authorization ?? null

      // Authenticate
      const authResult = await authenticateMcpRequest(
        authHeader,
        container.cacheStore,
        container.relationalStore
      )

      if (isAuthError(authResult)) {
        if (authResult.wwwAuthenticate) {
          res.setHeader("WWW-Authenticate", authResult.wwwAuthenticate)
        }
        sendJson(res, authResult.status, { error: authResult.message })
        return
      }

      const ctx = authResult as McpAuthContext

      if (method === "POST") {
        return handleMcpPost(req, res, ctx, container)
      }

      if (method === "GET") {
        // SSE endpoint for server notifications
        return handleMcpSse(req, res, ctx)
      }

      sendJson(res, 405, { error: "Method not allowed" })
      return
    }

    // ── 404 ───────────────────────────────────────────────
    sendJson(res, 404, { error: "Not found" })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[MCP Transport] Unhandled error:", message)
    sendJson(res, 500, { error: "Internal server error" })
  }
}

async function handleMcpPost(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: McpAuthContext,
  container: { cacheStore: import("@/lib/ports/cache-store").ICacheStore } & import("@/lib/di/container").Container
): Promise<void> {
  // Rate limit check
  const rateLimitId = ctx.apiKeyId ?? ctx.userId
  const rateResult = await checkRateLimit(container.cacheStore, rateLimitId)

  if (!rateResult.allowed) {
    const errorBody = formatRateLimitError()
    res.setHeader("X-RateLimit-Remaining", "0")
    sendJson(res, 200, {
      jsonrpc: "2.0",
      id: null,
      result: errorBody,
    })
    return
  }

  if (rateResult.remaining >= 0) {
    res.setHeader("X-RateLimit-Remaining", String(rateResult.remaining))
  }

  // Parse body
  const body = await parseBody(req)
  const scrubbed = scrubMCPPayload(body)

  // Session management
  let sessionId = req.headers["mcp-session-id"] as string | undefined
  if (!sessionId) {
    sessionId = randomUUID()
    // Store session in Redis
    await container.cacheStore.set(
      `mcp:session:${sessionId}`,
      {
        orgId: ctx.orgId,
        repoId: ctx.repoId,
        userId: ctx.userId,
        authMode: ctx.authMode,
        createdAt: Date.now(),
        lastToolCallAt: Date.now(),
      },
      SESSION_TTL
    )
  } else {
    // Update last activity
    await container.cacheStore.set(
      `mcp:session:${sessionId}`,
      {
        orgId: ctx.orgId,
        repoId: ctx.repoId,
        userId: ctx.userId,
        authMode: ctx.authMode,
        lastToolCallAt: Date.now(),
      },
      SESSION_TTL
    )
  }

  res.setHeader("Mcp-Session-Id", sessionId)

  // Handle the MCP request
  const response = await handleMcpRequest(scrubbed, ctx, container)

  // Scrub outbound response too
  const scrubbedResponse = scrubMCPPayload(response)

  sendJson(res, 200, scrubbedResponse)
}

function handleMcpSse(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: McpAuthContext
): void {
  // SSE endpoint for server-initiated notifications
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  // Send initial ping
  res.write("event: ping\ndata: {}\n\n")

  // Keep connection alive with periodic pings
  const interval = setInterval(() => {
    try {
      res.write("event: ping\ndata: {}\n\n")
    } catch {
      clearInterval(interval)
    }
  }, 30000)

  _req.on("close", () => {
    clearInterval(interval)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}
