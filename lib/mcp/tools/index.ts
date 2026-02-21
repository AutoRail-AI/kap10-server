/**
 * MCP Tool Registry — registers all Phase 2–5.6 tools.
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
import {
  GET_BUSINESS_CONTEXT_SCHEMA, handleGetBusinessContext,
  SEARCH_BY_PURPOSE_SCHEMA, handleSearchByPurpose,
  ANALYZE_IMPACT_SCHEMA, handleAnalyzeImpact,
  GET_BLUEPRINT_SCHEMA, handleGetBlueprint,
} from "./business"
import { GET_RECENT_CHANGES_SCHEMA, handleGetRecentChanges } from "./changes"
// Phase 5.5: Prompt Ledger & Rewind
import { GET_TIMELINE_SCHEMA, handleGetTimeline, MARK_WORKING_SCHEMA, handleMarkWorking } from "./timeline"
import { REVERT_TO_WORKING_SCHEMA, handleRevertToWorking } from "./rewind"
// Phase 5.6: Dirty state overlay
import { SYNC_DIRTY_BUFFER_SCHEMA, handleSyncDirtyBuffer } from "./dirty-buffer"

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
  // Phase 4: Business intelligence tools
  { ...GET_BUSINESS_CONTEXT_SCHEMA, requiredScope: "mcp:read" },
  { ...SEARCH_BY_PURPOSE_SCHEMA, requiredScope: "mcp:read" },
  { ...ANALYZE_IMPACT_SCHEMA, requiredScope: "mcp:read" },
  { ...GET_BLUEPRINT_SCHEMA, requiredScope: "mcp:read" },
  // Phase 5: Incremental indexing tools
  { ...GET_RECENT_CHANGES_SCHEMA, requiredScope: "mcp:read" },
  // Phase 5.5: Prompt Ledger & Rewind
  { ...GET_TIMELINE_SCHEMA, requiredScope: "mcp:read" },
  { ...MARK_WORKING_SCHEMA, requiredScope: "mcp:sync" },
  { ...REVERT_TO_WORKING_SCHEMA, requiredScope: "mcp:sync" },
  // Phase 5.6: Dirty state overlay
  { ...SYNC_DIRTY_BUFFER_SCHEMA, requiredScope: "mcp:sync" },
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
  // Phase 4: Business intelligence tools
  get_business_context: { handler: handleGetBusinessContext as ToolHandler, scope: "mcp:read" },
  search_by_purpose: { handler: handleSearchByPurpose as ToolHandler, scope: "mcp:read" },
  analyze_impact: { handler: handleAnalyzeImpact as ToolHandler, scope: "mcp:read" },
  get_blueprint: { handler: handleGetBlueprint as ToolHandler, scope: "mcp:read" },
  // Phase 5: Incremental indexing tools
  get_recent_changes: { handler: handleGetRecentChanges as ToolHandler, scope: "mcp:read" },
  // Phase 5.5: Prompt Ledger & Rewind
  get_timeline: { handler: handleGetTimeline as ToolHandler, scope: "mcp:read" },
  mark_working: { handler: handleMarkWorking as ToolHandler, scope: "mcp:sync" },
  revert_to_working_state: { handler: handleRevertToWorking as ToolHandler, scope: "mcp:sync" },
  // Phase 5.6: Dirty state overlay
  sync_dirty_buffer: { handler: handleSyncDirtyBuffer as ToolHandler, scope: "mcp:sync" },
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
