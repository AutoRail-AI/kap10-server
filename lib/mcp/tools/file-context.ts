/**
 * J-01: file_context MCP tool — proactive, rich context for a file.
 *
 * Returns all entities in a file along with their justifications, graph
 * neighbors, feature tags, and domain concepts. Designed for AI agents
 * to proactively fetch comprehensive context before modifying a file.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

export const FILE_CONTEXT_SCHEMA = {
  name: "file_context",
  description:
    "Get comprehensive context for a file: all entities with their business justifications, callers/callees, feature tags, and domain concepts. Use this proactively before modifying a file to understand its role in the codebase.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "File path (repo-root-relative, e.g., src/auth/login.ts)",
      },
    },
    required: ["path"],
  },
}

export async function handleFileContext(
  args: { path: string },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  if (!args.path) {
    return formatToolError("path parameter is required")
  }

  const entities = await container.graphStore.getEntitiesByFile(
    ctx.orgId,
    repoId,
    args.path
  )

  if (entities.length === 0) {
    return formatToolError(`File "${args.path}" not found or contains no indexed entities`)
  }

  // Fetch justifications for all entities in the file
  const justifications = await container.graphStore.getJustifications(ctx.orgId, repoId)
  const justMap = new Map<string, typeof justifications[number]>()
  for (const j of justifications) {
    justMap.set(j.entity_id, j)
  }

  // Fetch graph edges for caller/callee info
  const entityIds = entities.map((e) => e.id)
  const edges = await container.graphStore.getAllEdges(ctx.orgId, repoId)

  // Build entity summaries with justification + graph context
  const entitySummaries = entities.map((entity) => {
    const justification = justMap.get(entity.id)

    // Find callers (inbound edges)
    const callerEdges = edges.filter((e) => e._to.endsWith(`/${entity.id}`) && e.kind === "calls")
    // Find callees (outbound edges)
    const calleeEdges = edges.filter((e) => e._from.endsWith(`/${entity.id}`) && e.kind === "calls")

    const summary: Record<string, unknown> = {
      name: entity.name,
      kind: entity.kind,
      line: Number(entity.start_line) || 0,
      signature: entity.signature ?? entity.name,
    }

    if (justification) {
      summary.business_purpose = justification.business_purpose
      summary.taxonomy = justification.taxonomy
      summary.feature_tag = justification.feature_tag
      summary.domain_concepts = justification.domain_concepts
      summary.confidence = justification.confidence
      if (justification.architectural_pattern) {
        summary.architectural_pattern = justification.architectural_pattern
      }
    }

    if (callerEdges.length > 0) {
      summary.caller_count = callerEdges.length
    }
    if (calleeEdges.length > 0) {
      summary.callee_count = calleeEdges.length
    }

    return summary
  })

  // Aggregate file-level feature tags and domain concepts
  const featureTags = new Map<string, number>()
  const domainConcepts = new Map<string, number>()
  for (const entity of entities) {
    const j = justMap.get(entity.id)
    if (j) {
      featureTags.set(j.feature_tag, (featureTags.get(j.feature_tag) ?? 0) + 1)
      for (const concept of j.domain_concepts ?? []) {
        domainConcepts.set(concept, (domainConcepts.get(concept) ?? 0) + 1)
      }
    }
  }

  // Determine file language
  const ext = args.path.split(".").pop() ?? ""
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
    cs: "csharp", cpp: "cpp", c: "c", h: "c",
  }

  // Sort feature tags by frequency descending
  const sortedFeatureTags = Array.from(featureTags.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)

  const sortedDomainConcepts = Array.from(domainConcepts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([concept]) => concept)

  return formatToolResponse({
    file: {
      path: args.path,
      language: langMap[ext] ?? ext,
      entity_count: entities.length,
      feature_tags: sortedFeatureTags,
      domain_concepts: sortedDomainConcepts,
    },
    entities: entitySummaries,
  })
}
