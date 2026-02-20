/**
 * MCP tracing helper — OpenTelemetry spans for tool handlers.
 * Integrates with Phase 0's Langfuse + Vercel OpenTelemetry setup.
 */

import type { McpAuthContext } from "./auth"

/**
 * Create a tool span context for tracing.
 * In production, this wraps @opentelemetry/api tracer spans.
 * For now, provides structured logging context.
 */
export function createToolSpanContext(
  toolName: string,
  ctx: McpAuthContext
): Record<string, string> {
  return {
    "mcp.tool": toolName,
    "mcp.org_id": ctx.orgId,
    "mcp.repo_id": ctx.repoId ?? "",
    "mcp.auth_mode": ctx.authMode,
    "mcp.user_id": ctx.userId ?? "",
  }
}

/**
 * Log a tool invocation with tracing context.
 */
export function logToolInvocation(
  toolName: string,
  ctx: McpAuthContext,
  durationMs: number,
  error?: string
): void {
  const spanCtx = createToolSpanContext(toolName, ctx)
  if (error) {
    console.error(
      `[MCP] tool=${toolName} org=${ctx.orgId} repo=${ctx.repoId} auth=${ctx.authMode} duration=${durationMs}ms error=${error}`,
      spanCtx
    )
  } else {
    console.log(
      `[MCP] tool=${toolName} org=${ctx.orgId} repo=${ctx.repoId} auth=${ctx.authMode} duration=${durationMs}ms`,
      spanCtx
    )
  }
}
