/**
 * Phase 4: Business intelligence MCP tools.
 *
 * 4 tools:
 * 1. get_business_context — justification + taxonomy for an entity
 * 2. search_by_purpose — semantic search on justification embeddings
 * 3. analyze_impact — N-hop traversal with business context
 * 4. get_blueprint — feature map + health risks + ADR summaries
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

// ── get_business_context ────────────────────────────────────────

export const GET_BUSINESS_CONTEXT_SCHEMA = {
  name: "get_business_context",
  description:
    "Get the business justification, taxonomy (VERTICAL/HORIZONTAL/UTILITY), confidence score, and semantic triples for a code entity. Explains WHY code exists from a business perspective.",
  inputSchema: {
    type: "object" as const,
    properties: {
      entity_name: {
        type: "string",
        description: "Name of the entity to look up",
      },
    },
    required: ["entity_name"],
  },
}

export async function handleGetBusinessContext(
  args: { entity_name: string },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }
  if (!args.entity_name) {
    return formatToolError("entity_name parameter is required")
  }

  // Find entity
  const results = await container.graphStore.searchEntities(ctx.orgId, repoId, args.entity_name, 5)
  const match = results.find((r) => r.name === args.entity_name) ?? results[0]
  if (!match) {
    return formatToolError(`Entity "${args.entity_name}" not found in this repository`)
  }

  // Find entity ID
  const fileEntities = await container.graphStore.getEntitiesByFile(ctx.orgId, repoId, match.file_path)
  const entity = fileEntities.find((e) => e.name === args.entity_name)
  if (!entity) {
    return formatToolError(`Entity "${args.entity_name}" not found`)
  }

  // Get justification
  const justification = await container.graphStore.getJustification(ctx.orgId, entity.id)

  if (!justification) {
    return formatToolResponse({
      entity: { name: entity.name, kind: entity.kind, file_path: entity.file_path },
      justification: null,
      message: "No justification available yet. Run the justification pipeline first.",
    })
  }

  return formatToolResponse({
    entity: {
      name: entity.name,
      kind: entity.kind,
      file_path: entity.file_path,
      line: Number(entity.start_line) || 0,
    },
    justification: {
      taxonomy: justification.taxonomy,
      confidence: justification.confidence,
      businessPurpose: justification.business_purpose,
      domainConcepts: justification.domain_concepts,
      featureTag: justification.feature_tag,
      semanticTriples: justification.semantic_triples,
      complianceTags: justification.compliance_tags,
      architecturalPattern: (justification as Record<string, unknown>).architectural_pattern ?? null,
      reasoning: (justification as Record<string, unknown>).reasoning ?? null,
      modelTier: justification.model_tier,
    },
  })
}

// ── search_by_purpose ───────────────────────────────────────────

export const SEARCH_BY_PURPOSE_SCHEMA = {
  name: "search_by_purpose",
  description:
    "Search for code entities by their business purpose using semantic search on justification embeddings. Optionally filter by taxonomy (VERTICAL/HORIZONTAL/UTILITY).",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Natural language description of the business purpose to search for",
      },
      taxonomy: {
        type: "string",
        description: "Filter by taxonomy: VERTICAL, HORIZONTAL, or UTILITY",
      },
      limit: {
        type: "number",
        description: "Maximum results (default 10, max 30)",
      },
    },
    required: ["query"],
  },
}

export async function handleSearchByPurpose(
  args: { query: string; taxonomy?: string; limit?: number },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }
  if (!args.query) {
    return formatToolError("query parameter is required")
  }

  const limit = Math.min(Math.max(args.limit ?? 10, 1), 30)

  // Embed the query using query-optimized encoding
  const embedFn = container.vectorSearch.embedQuery
    ? container.vectorSearch.embedQuery.bind(container.vectorSearch)
    : async (text: string) => (await container.vectorSearch.embed([text]))[0]!
  const queryEmbedding = await embedFn(args.query)

  // Use dedicated justification search if available (queries justification_embeddings table)
  if (container.vectorSearch.searchJustificationEmbeddings) {
    const results = await container.vectorSearch.searchJustificationEmbeddings(
      queryEmbedding,
      limit,
      { orgId: ctx.orgId, repoId, taxonomy: args.taxonomy }
    )

    return formatToolResponse({
      query: args.query,
      taxonomy: args.taxonomy ?? "any",
      results: results.map((r) => ({
        entityId: r.entityId,
        entityName: r.entityName,
        score: Math.round(r.score * 1000) / 1000,
        taxonomy: r.taxonomy,
        featureTag: r.featureTag,
        businessPurpose: r.businessPurpose,
      })),
      count: results.length,
    })
  }

  // Fallback: search entity_embeddings (pre-migration compatibility)
  const results = await container.vectorSearch.search(queryEmbedding, limit * 2, {
    orgId: ctx.orgId,
    repoId,
  })

  const topResults = results.slice(0, limit).map((r) => ({
    entityId: r.id,
    entityName: (r.metadata?.entityName as string) ?? r.id,
    score: Math.round(r.score * 1000) / 1000,
    taxonomy: (r.metadata?.entityType as string) ?? "unknown",
    featureTag: "",
    businessPurpose: "",
  }))

  return formatToolResponse({
    query: args.query,
    taxonomy: args.taxonomy ?? "any",
    results: topResults,
    count: topResults.length,
  })
}

// ── analyze_impact ──────────────────────────────────────────────

export const ANALYZE_IMPACT_SCHEMA = {
  name: "analyze_impact",
  description:
    "Analyze the business impact of changing a code entity. Returns N-hop affected entities with their business context, taxonomy, and confidence scores.",
  inputSchema: {
    type: "object" as const,
    properties: {
      entity_name: {
        type: "string",
        description: "Name of the entity to analyze impact for",
      },
      depth: {
        type: "number",
        description: "Maximum traversal depth (default 2, max 5)",
      },
    },
    required: ["entity_name"],
  },
}

export async function handleAnalyzeImpact(
  args: { entity_name: string; depth?: number },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }
  if (!args.entity_name) {
    return formatToolError("entity_name parameter is required")
  }

  const depth = Math.min(Math.max(args.depth ?? 2, 1), 5)

  // Find entity
  const results = await container.graphStore.searchEntities(ctx.orgId, repoId, args.entity_name, 5)
  const match = results.find((r) => r.name === args.entity_name) ?? results[0]
  if (!match) {
    return formatToolError(`Entity "${args.entity_name}" not found`)
  }

  const fileEntities = await container.graphStore.getEntitiesByFile(ctx.orgId, repoId, match.file_path)
  const entity = fileEntities.find((e) => e.name === args.entity_name)
  if (!entity) {
    return formatToolError(`Entity "${args.entity_name}" not found`)
  }

  // Get subgraph
  const subgraph = await container.graphStore.getSubgraph(ctx.orgId, entity.id, depth)

  // Enrich with justifications
  const affected = await Promise.all(
    subgraph.entities
      .filter((e) => e.id !== entity.id)
      .slice(0, 30)
      .map(async (e) => {
        const justification = await container.graphStore.getJustification(ctx.orgId, e.id)
        return {
          name: e.name,
          kind: e.kind,
          file_path: e.file_path,
          taxonomy: justification?.taxonomy ?? "unknown",
          confidence: justification?.confidence ?? 0,
          businessPurpose: justification?.business_purpose ?? "no justification",
          featureTag: justification?.feature_tag ?? "unknown",
          reasoning: justification ? ((justification as Record<string, unknown>).reasoning ?? null) : null,
        }
      })
  )

  // Group by taxonomy for summary
  const byTaxonomy: Record<string, number> = {}
  for (const a of affected) {
    byTaxonomy[a.taxonomy] = (byTaxonomy[a.taxonomy] ?? 0) + 1
  }

  return formatToolResponse({
    entity: { name: entity.name, kind: entity.kind, file_path: entity.file_path },
    depth,
    affected,
    summary: {
      totalAffected: affected.length,
      byTaxonomy,
    },
  })
}

// ── get_blueprint ───────────────────────────────────────────────

export const GET_BLUEPRINT_SCHEMA = {
  name: "get_blueprint",
  description:
    "Get a high-level blueprint of the repository: features with entry points, health risks, and ADR summaries. Provides a business-oriented overview of the codebase architecture.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
}

export async function handleGetBlueprint(
  _args: Record<string, unknown>,
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  // Fetch all Phase 4 data
  const [features, healthReport, adrs] = await Promise.all([
    container.graphStore.getFeatureAggregations(ctx.orgId, repoId),
    container.graphStore.getHealthReport(ctx.orgId, repoId),
    container.graphStore.getADRs(ctx.orgId, repoId),
  ])

  if (features.length === 0 && !healthReport) {
    return formatToolResponse({
      message: "No business intelligence data available. Run the justification pipeline first.",
      features: [],
      health: null,
      adrs: [],
    })
  }

  return formatToolResponse({
    features: features
      .sort((a, b) => b.entity_count - a.entity_count)
      .slice(0, 20)
      .map((f) => ({
        featureTag: f.feature_tag,
        entityCount: f.entity_count,
        entryPoints: f.entry_points.slice(0, 5),
        taxonomyBreakdown: f.taxonomy_breakdown,
        averageConfidence: Math.round(f.average_confidence * 100) / 100,
      })),
    health: healthReport
      ? {
          totalEntities: healthReport.total_entities,
          justifiedEntities: healthReport.justified_entities,
          averageConfidence: healthReport.average_confidence,
          taxonomyBreakdown: healthReport.taxonomy_breakdown,
          risks: healthReport.risks.slice(0, 10),
        }
      : null,
    adrs: adrs.slice(0, 10).map((a) => ({
      featureArea: a.feature_area,
      title: a.title,
      context: a.context.slice(0, 200),
      decision: a.decision.slice(0, 200),
    })),
  })
}
