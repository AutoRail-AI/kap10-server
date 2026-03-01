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

  // L-14: Use entity profiles for rich context (falls back to direct DB on cache miss)
  const entityIds = entities.map((e) => e.id)
  let profileMap = new Map<string, import("@/lib/mcp/entity-profile").EntityProfile>()
  try {
    const { getEntityProfiles } = require("@/lib/mcp/entity-profile") as typeof import("@/lib/mcp/entity-profile")
    profileMap = await getEntityProfiles(ctx.orgId, repoId, entityIds, container)
  } catch {
    // Profile cache unavailable — fall back to justifications
  }

  // Build entity summaries from profiles
  const entitySummaries = entities.map((entity) => {
    const profile = profileMap.get(entity.id)
    const summary: Record<string, unknown> = {
      name: entity.name,
      kind: entity.kind,
      line: Number(entity.start_line) || 0,
      signature: entity.signature ?? entity.name,
    }

    if (profile) {
      summary.business_purpose = profile.business_purpose
      summary.taxonomy = profile.taxonomy
      summary.feature_tag = profile.feature_tag
      summary.domain_concepts = profile.domain_concepts
      summary.confidence = profile.confidence
      summary.caller_count = profile.callers.length
      summary.callee_count = profile.callees.length
      summary.community = profile.community
      if (profile.architectural_pattern) summary.architectural_pattern = profile.architectural_pattern
      if (profile.is_dead_code) summary.is_dead_code = true
      if (profile.change_frequency != null) summary.change_frequency = profile.change_frequency
      if (profile.stability_score != null) summary.stability_score = profile.stability_score
    }

    return summary
  })

  // Aggregate file-level feature tags and domain concepts from profiles
  const featureTags = new Map<string, number>()
  const domainConcepts = new Map<string, number>()
  for (const entity of entities) {
    const profile = profileMap.get(entity.id)
    if (profile) {
      featureTags.set(profile.feature_tag, (featureTags.get(profile.feature_tag) ?? 0) + 1)
      for (const concept of profile.domain_concepts) {
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
