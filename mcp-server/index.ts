#!/usr/bin/env tsx
/**
 * Standalone MCP Server entry point.
 * Runs as an independent Node.js HTTP server — not part of Next.js.
 *
 * Usage:
 *   pnpm mcp:server           # Development
 *   node mcp-server/index.ts  # Production (via tsx or compiled)
 *
 * Env vars:
 *   MCP_SERVER_PORT — HTTP port (default 8787)
 *   MCP_SERVER_URL  — Public URL for OAuth metadata (default http://localhost:8787)
 *
 * The server initializes the DI container (ArangoDB, Redis, Prisma) and exposes:
 *   POST /mcp                               — MCP JSON-RPC (tool calls)
 *   GET  /mcp                               — SSE (server notifications)
 *   GET  /.well-known/oauth-protected-resource   — RFC 9728
 *   GET  /.well-known/oauth-authorization-server — RFC 8414
 *   POST /oauth/register                    — RFC 7591 Dynamic Client Registration
 *   POST /oauth/token                       — OAuth token endpoint
 *   GET  /health                            — Health check
 */

// Load .env.local / .env (no-op in Docker where env is injected by compose)
import { config } from "dotenv"
import { createServer } from "http"
import path from "node:path"
config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true })
config({ path: path.resolve(process.cwd(), ".env"), quiet: true })

// Force environment before container loads
if (!process.env.NODE_ENV) {
  ;(process.env as Record<string, string>).NODE_ENV = "production"
}

async function main() {
  const port = parseInt(process.env.MCP_SERVER_PORT ?? "8787", 10)

  // Lazy-import the transport handler to allow env vars to load first
  const { handleHttpRequest } = await import("@/lib/mcp/transport")

  const server = createServer(async (req, res) => {
    try {
      await handleHttpRequest(req, res)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[MCP Server] Fatal request error:", message)
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Internal server error" }))
      }
    }
  })

  // Graceful shutdown
  const shutdown = () => {
    console.log("[MCP Server] Shutting down gracefully...")
    server.close(() => {
      console.log("[MCP Server] Closed.")
      process.exit(0)
    })
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10_000)
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  server.listen(port, () => {
    const url = process.env.MCP_SERVER_URL ?? `http://localhost:${port}`
    console.log(`
┌──────────────────────────────────────────────────┐
│  unerr MCP Server                                │
│  ────────────────────────────────────────────     │
│  Listening on port ${String(port).padEnd(5)}                          │
│  Public URL: ${url.padEnd(35)} │
│                                                  │
│  Endpoints:                                      │
│    POST /mcp            → MCP tool calls         │
│    GET  /mcp            → SSE notifications      │
│    GET  /health         → Health check           │
│    POST /oauth/register → DCR                    │
│    POST /oauth/token    → Token exchange          │
└──────────────────────────────────────────────────┘
`)
  })
}

main().catch((err: unknown) => {
  console.error("[MCP Server] Failed to start:", err)
  process.exit(1)
})
