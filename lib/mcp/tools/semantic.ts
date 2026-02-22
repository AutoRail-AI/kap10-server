/**
 * Phase 3: semantic_search and find_similar MCP tools.
 *
 * semantic_search — Hybrid semantic + keyword search with Two-Step RAG.
 *   Returns summaries only (no full bodies). Agents follow up with
 *   get_function/get_class for full details.
 *
 * find_similar — Find entities structurally/semantically similar to a reference.
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"
import { hybridSearch, type SearchMode } from "@/lib/embeddings/hybrid-search"
import { getPrefetchedContext } from "@/lib/use-cases/prefetch-context"

// ── semantic_search ───────────────────────────────────────────────────────────

export const SEMANTIC_SEARCH_SCHEMA = {
  name: "semantic_search",
  description:
    "Search for code entities by meaning using hybrid semantic + keyword search. " +
    "Returns lightweight summaries (name, signature, file path, callers/callees) — " +
    "NO full entity bodies. If a result looks relevant, use `get_function` or `get_class` " +
    "to retrieve the full body. This two-step approach prevents context window bloat.\n\n" +
    "Search modes:\n" +
    "- 'keyword': Use for exact variable/function/class names\n" +
    "- 'semantic': Use for conceptual queries like 'authentication logic' or 'error handling patterns'\n" +
    "- 'hybrid' (default): Combines both strategies via Reciprocal Rank Fusion",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Natural language search query — describe what you're looking for",
      },
      mode: {
        type: "string",
        enum: ["hybrid", "semantic", "keyword"],
        description: "Search mode: 'hybrid' (default), 'semantic', or 'keyword'",
      },
      limit: {
        type: "number",
        description: "Maximum results to return (default 10, max 50)",
      },
    },
    required: ["query"],
  },
}

export async function handleSemanticSearch(
  args: { query: string; mode?: string; limit?: number },
  ctx: McpAuthContext,
  container: Container
) {
  if (!args.query || args.query.trim().length === 0) {
    return formatToolError("query parameter is required and cannot be empty")
  }

  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  const mode = validateSearchMode(args.mode)
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50)

  // Phase 10b: Check prefetch cache before running full search
  try {
    const prefetched = await getPrefetchedContext(container, ctx.orgId, repoId, args.query.trim())
    if (prefetched && prefetched.entities.length > 0) {
      const cachedSummaries = prefetched.entities.slice(0, limit).map((e) => ({
        entityKey: e.key,
        entityName: e.name,
        entityType: e.kind,
        filePath: e.file_path,
        lineStart: 0,
        signature: "",
        score: 1.0,
        callers: [],
        callees: [],
      }))

      return formatToolResponse({
        query: args.query,
        mode,
        results: cachedSummaries,
        count: cachedSummaries.length,
        _hint: "Use get_function or get_class with the entityKey to retrieve full source code for relevant results.",
        _meta: { source: "cloud_prefetched" },
      })
    }
  } catch {
    // Prefetch cache miss — fall through to normal search
  }

  const searchResult = await hybridSearch(
    {
      query: args.query.trim(),
      orgId: ctx.orgId,
      repoId,
      workspaceId: ctx.workspaceId,
      mode,
      limit,
    },
    container
  )

  // Two-Step RAG: Return summaries only — no full bodies
  const summaries = searchResult.results.map((r) => ({
    entityKey: r.entityKey,
    entityName: r.entityName,
    entityType: r.entityType,
    filePath: r.filePath,
    lineStart: r.lineStart,
    signature: r.signature,
    score: Math.round(r.score * 1000) / 1000,
    callers: r.callers,
    callees: r.callees,
  }))

  return formatToolResponse({
    query: args.query,
    mode,
    results: summaries,
    count: summaries.length,
    _hint: summaries.length > 0
      ? "Use get_function or get_class with the entityKey to retrieve full source code for relevant results."
      : "No results found. Try a broader query or different terms.",
    ...(searchResult.meta.degraded ? { _meta: { degraded: searchResult.meta.degraded } } : {}),
  })
}

function validateSearchMode(mode?: string): SearchMode {
  if (mode === "semantic" || mode === "keyword" || mode === "hybrid") return mode
  return "hybrid"
}

// ── find_similar ──────────────────────────────────────────────────────────────

export const FIND_SIMILAR_SCHEMA = {
  name: "find_similar",
  description:
    "Find code entities structurally and semantically similar to a reference entity. " +
    "Provide an entity key (e.g., from a previous search result) to discover related code. " +
    "If the entity has no embedding, it will be embedded on-the-fly.",
  inputSchema: {
    type: "object" as const,
    properties: {
      entityKey: {
        type: "string",
        description: "The entity key to find similar entities for",
      },
      limit: {
        type: "number",
        description: "Maximum similar entities to return (default 5, max 20)",
      },
    },
    required: ["entityKey"],
  },
}

export async function handleFindSimilar(
  args: { entityKey: string; limit?: number },
  ctx: McpAuthContext,
  container: Container
) {
  if (!args.entityKey || args.entityKey.trim().length === 0) {
    return formatToolError("entityKey parameter is required and cannot be empty")
  }

  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  const limit = Math.min(Math.max(args.limit ?? 5, 1), 20)

  // Look up existing embedding for this entity
  let embedding: number[] | null = null
  if (container.vectorSearch.getEmbedding) {
    embedding = await container.vectorSearch.getEmbedding(repoId, args.entityKey)
  }

  // If no embedding, try to embed on-the-fly
  if (!embedding) {
    // Fetch the entity from the graph store
    const entity = await container.graphStore.getEntity(ctx.orgId, args.entityKey)
    if (!entity) {
      return formatToolError(`Entity not found: ${args.entityKey}`)
    }

    // Build text for embedding
    const text = buildEntityText(entity)
    const embeddings = await container.vectorSearch.embed([text])
    embedding = embeddings[0]!
  }

  // Search for similar (topK + 1 to exclude self)
  const results = await container.vectorSearch.search(
    embedding,
    limit + 1,
    { orgId: ctx.orgId, repoId }
  )

  // Filter out self and limit
  const filtered = results
    .filter((r) => r.id !== args.entityKey)
    .slice(0, limit)

  const items = filtered.map((r) => ({
    entityKey: r.id,
    entityName: (r.metadata?.entityName as string) ?? r.id,
    entityType: (r.metadata?.entityType as string) ?? "unknown",
    filePath: (r.metadata?.filePath as string) ?? "",
    similarityScore: Math.round(r.score * 1000) / 1000,
  }))

  return formatToolResponse({
    referenceEntity: args.entityKey,
    results: items,
    count: items.length,
    _hint: items.length > 0
      ? "Use get_function or get_class to retrieve full source code for similar entities."
      : "No similar entities found.",
  })
}

function buildEntityText(entity: { kind: string; name: string; file_path: string; signature?: unknown; body?: unknown }): string {
  const kindLabel = entity.kind.charAt(0).toUpperCase() + entity.kind.slice(1)
  const parts: string[] = []
  parts.push(`${kindLabel}: ${entity.name}`)
  if (entity.file_path) parts.push(`File: ${entity.file_path}`)
  if (entity.signature) parts.push(`Signature: ${String(entity.signature)}`)
  if (entity.body) {
    const bodyStr = String(entity.body)
    parts.push("")
    parts.push(bodyStr.length > 24000 ? bodyStr.slice(0, 24000) : bodyStr)
  }
  return parts.join("\n")
}
