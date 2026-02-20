/**
 * MCP Tool Registry — registers all 11 Phase 2 + Phase 3 tools.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { hasScope } from "../auth"
import { formatToolError } from "../formatter"
import { GET_CALLERS_SCHEMA, GET_CALLEES_SCHEMA, GET_IMPORTS_SCHEMA, handleGetCallers, handleGetCallees, handleGetImports } from "./graph"
import { GET_CLASS_SCHEMA, GET_FILE_SCHEMA, GET_FUNCTION_SCHEMA, handleGetClass, handleGetFile, handleGetFunction } from "./inspect"
import { SEARCH_CODE_SCHEMA, handleSearchCode } from "./search"
import { SEMANTIC_SEARCH_SCHEMA, FIND_SIMILAR_SCHEMA, handleSemanticSearch, handleFindSimilar } from "./semantic"
import { GET_PROJECT_STATS_SCHEMA, handleGetProjectStats } from "./stats"
import { SYNC_LOCAL_DIFF_SCHEMA, handleSyncLocalDiff } from "./sync"

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  requiredScope: string
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { ...SEARCH_CODE_SCHEMA, requiredScope: "mcp:read" },
  { ...SEMANTIC_SEARCH_SCHEMA, requiredScope: "mcp:read" },
  { ...FIND_SIMILAR_SCHEMA, requiredScope: "mcp:read" },
  { ...GET_FUNCTION_SCHEMA, requiredScope: "mcp:read" },
  { ...GET_CLASS_SCHEMA, requiredScope: "mcp:read" },
  { ...GET_FILE_SCHEMA, requiredScope: "mcp:read" },
  { ...GET_CALLERS_SCHEMA, requiredScope: "mcp:read" },
  { ...GET_CALLEES_SCHEMA, requiredScope: "mcp:read" },
  { ...GET_IMPORTS_SCHEMA, requiredScope: "mcp:read" },
  { ...GET_PROJECT_STATS_SCHEMA, requiredScope: "mcp:read" },
  { ...SYNC_LOCAL_DIFF_SCHEMA, requiredScope: "mcp:sync" },
]

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: McpAuthContext,
  container: Container
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>

const TOOL_HANDLERS: Record<string, { handler: ToolHandler; scope: string }> = {
  search_code: { handler: handleSearchCode as ToolHandler, scope: "mcp:read" },
  semantic_search: { handler: handleSemanticSearch as ToolHandler, scope: "mcp:read" },
  find_similar: { handler: handleFindSimilar as ToolHandler, scope: "mcp:read" },
  get_function: { handler: handleGetFunction as ToolHandler, scope: "mcp:read" },
  get_class: { handler: handleGetClass as ToolHandler, scope: "mcp:read" },
  get_file: { handler: handleGetFile as ToolHandler, scope: "mcp:read" },
  get_callers: { handler: handleGetCallers as ToolHandler, scope: "mcp:read" },
  get_callees: { handler: handleGetCallees as ToolHandler, scope: "mcp:read" },
  get_imports: { handler: handleGetImports as ToolHandler, scope: "mcp:read" },
  get_project_stats: { handler: handleGetProjectStats as ToolHandler, scope: "mcp:read" },
  sync_local_diff: { handler: handleSyncLocalDiff as ToolHandler, scope: "mcp:sync" },
}

/**
 * Dispatch a tool call to the appropriate handler.
 * Checks scope permissions before execution.
 */
export async function dispatchToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: McpAuthContext,
  container: Container
) {
  const entry = TOOL_HANDLERS[toolName]
  if (!entry) {
    return formatToolError(`Unknown tool: "${toolName}". Available tools: ${Object.keys(TOOL_HANDLERS).join(", ")}`)
  }

  // Check scope
  if (!hasScope(ctx, entry.scope)) {
    return formatToolError(
      `This API key does not have the '${entry.scope}' scope. Required scope for ${toolName}: ${entry.scope}`
    )
  }

  return entry.handler(args, ctx, container)
}

/**
 * Get all tool schemas for MCP ListTools response.
 */
export function getToolSchemas(): Array<{
  name: string
  description: string
  inputSchema: Record<string, unknown>
}> {
  return TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }))
}
