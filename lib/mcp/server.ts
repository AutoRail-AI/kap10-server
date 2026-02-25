/**
 * MCP Server factory — creates per-session MCP server instances.
 * Uses @modelcontextprotocol/sdk with Streamable HTTP transport (2025-03-26 spec).
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "./auth"
import { scrubMCPPayload } from "./security/scrubber"
import { dispatchToolCall, getToolSchemas } from "./tools"
import { logToolInvocation } from "./tracing"

export interface McpServerConfig {
  name: string
  version: string
}

const DEFAULT_CONFIG: McpServerConfig = {
  name: "unerr-mcp",
  version: "0.2.0",
}

/**
 * Handle an MCP JSON-RPC request.
 * This is the core handler used by both Streamable HTTP and SSE transports.
 */
export async function handleMcpRequest(
  request: Record<string, unknown>,
  ctx: McpAuthContext,
  container: Container,
  config: McpServerConfig = DEFAULT_CONFIG
): Promise<Record<string, unknown>> {
  const method = request.method as string
  const id = request.id as string | number | undefined
  const params = (request.params ?? {}) as Record<string, unknown>

  try {
    switch (method) {
      case "initialize":
        return jsonRpcResponse(id, {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: config.name,
            version: config.version,
          },
        })

      case "tools/list":
        return jsonRpcResponse(id, {
          tools: getToolSchemas(),
        })

      case "tools/call": {
        const toolName = params.name as string
        const toolArgs = scrubMCPPayload((params.arguments ?? {}) as Record<string, unknown>)

        const start = Date.now()
        try {
          const result = await dispatchToolCall(toolName, toolArgs, ctx, container)
          logToolInvocation(toolName, ctx, Date.now() - start)
          return jsonRpcResponse(id, result)
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          logToolInvocation(toolName, ctx, Date.now() - start, message)
          return jsonRpcResponse(id, {
            isError: true,
            content: [{ type: "text", text: `Internal error: ${message}` }],
          })
        }
      }

      case "ping":
        return jsonRpcResponse(id, {})

      case "notifications/initialized":
        // Client acknowledgment, no response needed for notifications
        return jsonRpcResponse(id, {})

      default:
        return jsonRpcError(id, -32601, `Method not found: ${method}`)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonRpcError(id, -32603, `Internal error: ${message}`)
  }
}

function jsonRpcResponse(id: string | number | undefined, result: unknown): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  }
}

function jsonRpcError(
  id: string | number | undefined,
  code: number,
  message: string
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  }
}
