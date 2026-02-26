/**
 * MCP Tool Registry — registers all Phase 2–7 tools.
 */

import type { Container } from "@/lib/di/container"
import {
  ANALYZE_IMPACT_SCHEMA, GET_BLUEPRINT_SCHEMA,
  GET_BUSINESS_CONTEXT_SCHEMA, handleAnalyzeImpact,
  handleGetBlueprint, handleGetBusinessContext,
  handleSearchByPurpose, SEARCH_BY_PURPOSE_SCHEMA,
} from "./business"
import { GET_RECENT_CHANGES_SCHEMA, handleGetRecentChanges } from "./changes"
import { handleSyncDirtyBuffer, SYNC_DIRTY_BUFFER_SCHEMA } from "./dirty-buffer"
import { GET_CALLEES_SCHEMA, GET_CALLERS_SCHEMA, GET_IMPORTS_SCHEMA, handleGetCallees, handleGetCallers, handleGetImports } from "./graph"
import { GET_CLASS_SCHEMA, GET_FILE_SCHEMA, GET_FUNCTION_SCHEMA, handleGetClass, handleGetFile, handleGetFunction } from "./inspect"
import { CHECK_PATTERNS_SCHEMA, GET_CONVENTIONS_SCHEMA, handleCheckPatterns, handleGetConventions, handleSuggestApproach, SUGGEST_APPROACH_SCHEMA } from "./patterns"
import { handleReviewPrStatus, REVIEW_PR_STATUS_SCHEMA } from "./review"
import { handleRevertToWorking, REVERT_TO_WORKING_SCHEMA } from "./rewind"
import { CHECK_RULES_SCHEMA, DRAFT_ARCHITECTURE_RULE_SCHEMA, GET_RELEVANT_RULES_SCHEMA, GET_RULES_SCHEMA, handleCheckRules, handleDraftArchitectureRule, handleGetRelevantRules, handleGetRules } from "./rules"
import { handleSearchCode, SEARCH_CODE_SCHEMA } from "./search"
import { FIND_SIMILAR_SCHEMA, handleFindSimilar, handleSemanticSearch, SEMANTIC_SEARCH_SCHEMA } from "./semantic"
import { GET_PROJECT_STATS_SCHEMA, handleGetProjectStats } from "./stats"
import { handleSyncLocalDiff, SYNC_LOCAL_DIFF_SCHEMA } from "./sync"
// Phase 5.5: Prompt Ledger & Rewind
import { GET_TIMELINE_SCHEMA, handleGetTimeline, handleMarkWorking, MARK_WORKING_SCHEMA } from "./timeline"
// Phase 5.6: Dirty state overlay
// Phase 6: Pattern Enforcement & Rules Engine
// Phase 7: PR Review Integration
import { hasScope } from "../auth"
import type { McpAuthContext } from "../auth"
import { formatToolError } from "../formatter"

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
  // Phase 6: Pattern Enforcement & Rules Engine
  { ...GET_RULES_SCHEMA, requiredScope: "mcp:read" },
  { ...CHECK_RULES_SCHEMA, requiredScope: "mcp:read" },
  { ...CHECK_PATTERNS_SCHEMA, requiredScope: "mcp:read" },
  { ...GET_CONVENTIONS_SCHEMA, requiredScope: "mcp:read" },
  { ...SUGGEST_APPROACH_SCHEMA, requiredScope: "mcp:read" },
  { ...GET_RELEVANT_RULES_SCHEMA, requiredScope: "mcp:read" },
  { ...DRAFT_ARCHITECTURE_RULE_SCHEMA, requiredScope: "mcp:sync" },
  // Phase 7: PR Review Integration
  { ...REVIEW_PR_STATUS_SCHEMA, requiredScope: "mcp:read" },
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
  // Phase 6: Pattern Enforcement & Rules Engine
  get_rules: { handler: handleGetRules as ToolHandler, scope: "mcp:read" },
  check_rules: { handler: handleCheckRules as ToolHandler, scope: "mcp:read" },
  check_patterns: { handler: handleCheckPatterns as ToolHandler, scope: "mcp:read" },
  get_conventions: { handler: handleGetConventions as ToolHandler, scope: "mcp:read" },
  suggest_approach: { handler: handleSuggestApproach as ToolHandler, scope: "mcp:read" },
  get_relevant_rules: { handler: handleGetRelevantRules as ToolHandler, scope: "mcp:read" },
  draft_architecture_rule: { handler: handleDraftArchitectureRule as ToolHandler, scope: "mcp:sync" },
  // Phase 7: PR Review Integration
  review_pr_status: { handler: handleReviewPrStatus as ToolHandler, scope: "mcp:read" },
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
