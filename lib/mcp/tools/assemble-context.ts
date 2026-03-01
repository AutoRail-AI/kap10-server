/**
 * L-27: assemble_context MCP tool — rich, structured context for a query.
 *
 * Chains semantic search → graph traversal → entity profiles → code snippets
 * into a single comprehensive response.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

export const ASSEMBLE_CONTEXT_SCHEMA = {
  name: "assemble_context",
  description:
    "Get rich, structured context for a query. Chains semantic search → graph traversal → " +
    "entity profiles → code snippets into a single response. Use this when you need comprehensive " +
    "understanding of a code area, not just individual entity lookups.\n\n" +
    "Returns: entry point entity, semantic neighborhood (sorted by centrality), code snippets, " +
    "community context, and confidence scores.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Natural language query describing what you need context about",
      },
      limit: {
        type: "number",
        description: "Max neighborhood entities to return (default 10, max 25)",
      },
      include_snippets: {
        type: "boolean",
        description: "Include code snippets for top entities (default true)",
      },
    },
    required: ["query"],
  },
}

export async function handleAssembleContext(
  args: { query: string; limit?: number; include_snippets?: boolean },
  ctx: McpAuthContext,
  container: Container,
) {
  if (!args.query || args.query.trim().length === 0) {
    return formatToolError("query parameter is required and cannot be empty")
  }

  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  try {
    const { assembleContext } = require("@/lib/mcp/context-assembly") as typeof import("@/lib/mcp/context-assembly")

    const result = await assembleContext(
      args.query.trim(),
      ctx.orgId,
      repoId,
      container,
      {
        limit: args.limit,
        includeSnippets: args.include_snippets,
      },
    )

    if (!result.entry_point) {
      return formatToolResponse({
        query: args.query,
        results: [],
        _hint: "No matching entities found. Try a broader query or different terms.",
      })
    }

    // Build a compact response for the agent
    const entryPoint = {
      name: result.entry_point.name,
      kind: result.entry_point.kind,
      file_path: result.entry_point.file_path,
      line: result.entry_point.line,
      signature: result.entry_point.signature,
      business_purpose: result.entry_point.business_purpose,
      taxonomy: result.entry_point.taxonomy,
      feature_tag: result.entry_point.feature_tag,
      centrality: result.entry_point.centrality,
      confidence: result.entry_point.confidence.composite,
      is_dead_code: result.entry_point.is_dead_code,
    }

    const neighborhood = result.semantic_neighborhood.map((n) => ({
      name: n.name,
      kind: n.kind,
      file_path: n.file_path,
      line: n.line,
      relationship: n.relationship,
      business_purpose: n.business_purpose,
      centrality: n.centrality,
      confidence: n.confidence.composite,
    }))

    return formatToolResponse({
      query: args.query,
      entry_point: entryPoint,
      neighborhood,
      code_snippets: result.code_snippets,
      community_context: result.community_context,
      confidence: result.confidence,
      _meta: result._meta,
      _hint: "Use get_function or get_class to retrieve full source code for specific entities.",
    })
  } catch (error: unknown) {
    return formatToolError(
      `Context assembly failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
