/**
 * Phase 3: Hybrid Search Pipeline
 *
 * Three-stage pipeline:
 *   1. Semantic leg (pgvector cosine similarity)
 *   2. Keyword leg (ArangoDB fulltext search, includes workspace overlay)
 *   3. Reciprocal Rank Fusion (RRF) merge with exact match boost
 *
 * Plus graph enrichment (callers/callees) and semantic truncation.
 *
 * Graceful degradation: each leg has an independent timeout.
 * If a leg fails, the pipeline continues with available results.
 */

import type { Container } from "@/lib/di/container"
import type { EntityDoc } from "@/lib/ports/types"

// ── Types ─────────────────────────────────────────────────────────────────────

export type SearchMode = "hybrid" | "semantic" | "keyword"

export interface HybridSearchInput {
  query: string
  orgId: string
  repoId: string
  workspaceId?: string
  mode: SearchMode
  limit: number
}

export interface SearchResultItem {
  entityKey: string
  entityName: string
  entityType: string
  filePath: string
  lineStart?: number
  lineEnd?: number
  signature?: string
  score: number
  callers?: string[]
  callees?: string[]
}

export interface HybridSearchResult {
  results: SearchResultItem[]
  meta: {
    mode: SearchMode
    totalResults: number
    queryTimeMs: number
    degraded?: Record<string, string>
  }
}

// ── RRF Algorithm ─────────────────────────────────────────────────────────────

interface RankedItem {
  entityKey: string
  entityName: string
  entityType: string
  filePath: string
  lineStart?: number
  signature?: string
  score: number
}

/**
 * Weighted Reciprocal Rank Fusion with Exact Match Boost.
 *
 * Weighted RRF: score = Σ weight_i / (k + rank_i) for each source
 * Code search favors exact lexical matches — keyword leg gets higher weight.
 * Lower k (default 30) creates steeper rank degradation, giving more influence
 * to top-ranked exact keyword matches.
 *
 * Exact match boost: entities with name exactly matching a query token get score = 1.0
 *
 * @param rankings - Array of ranked result lists (one per retrieval source)
 * @param queryTokens - Tokenized query terms for exact match detection
 * @param k - Smoothing constant (default 30 — tuned for code search)
 * @param limit - Max results to return
 * @param weights - Per-source weight multipliers (default all 1.0)
 */
export function reciprocalRankFusion(
  rankings: RankedItem[][],
  queryTokens: string[],
  k = 30,
  limit = 10,
  weights?: number[]
): RankedItem[] {
  // Phase 1: Weighted RRF scoring
  const scores = new Map<string, { item: RankedItem; score: number }>()

  for (let srcIdx = 0; srcIdx < rankings.length; srcIdx++) {
    const ranking = rankings[srcIdx]!
    const weight = weights?.[srcIdx] ?? 1.0

    for (let rank = 0; rank < ranking.length; rank++) {
      const item = ranking[rank]!
      const rrfScore = weight / (k + rank + 1)

      const existing = scores.get(item.entityKey)
      if (existing) {
        existing.score += rrfScore
        // Merge metadata — prefer item with more data
        if (item.signature && !existing.item.signature) {
          existing.item.signature = item.signature
        }
        if (item.lineStart !== undefined && existing.item.lineStart === undefined) {
          existing.item.lineStart = item.lineStart
        }
      } else {
        scores.set(item.entityKey, { item: { ...item }, score: rrfScore })
      }
    }
  }

  // Phase 2: Exact match boost
  const queryTokensLower = queryTokens.map((t) => t.toLowerCase())
  scores.forEach((entry) => {
    const nameLower = entry.item.entityName.toLowerCase()
    if (queryTokensLower.includes(nameLower)) {
      entry.score = 1.0 // Guaranteed top rank
    }
  })

  // Sort by score descending, then alphabetically for ties
  const merged = Array.from(scores.values())
  merged.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.item.entityName.localeCompare(b.item.entityName)
  })

  return merged.slice(0, limit).map((entry) => ({
    ...entry.item,
    score: entry.score,
  }))
}

/**
 * Tokenize a query string for RRF exact match detection.
 * Removes common stop words and returns significant tokens.
 */
export function tokenizeQuery(query: string): string[] {
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "that", "which", "who",
    "whom", "this", "these", "those", "it", "its", "of", "in", "to",
    "for", "with", "on", "at", "by", "from", "as", "into", "through",
    "during", "before", "after", "above", "below", "between", "and",
    "or", "but", "not", "no", "all", "each", "every", "both", "few",
    "more", "most", "other", "some", "such", "only", "own", "same",
    "so", "than", "too", "very", "just", "because", "if", "when", "how",
    "what", "where", "why", "functions", "function", "class", "classes",
    "method", "methods", "variable", "variables", "that", "handle",
    "handles", "get", "set", "find", "search",
  ])

  return query
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token))
}

// ── Hybrid Search Pipeline ────────────────────────────────────────────────────

/**
 * Execute the hybrid search pipeline.
 * Runs semantic and keyword legs in parallel, merges with RRF, enriches with graph data.
 */
export async function hybridSearch(
  input: HybridSearchInput,
  container: Container
): Promise<HybridSearchResult> {
  const startTime = Date.now()
  const degraded: Record<string, string> = {}

  // Determine which legs to run
  const runSemantic = input.mode === "hybrid" || input.mode === "semantic"
  const runKeyword = input.mode === "hybrid" || input.mode === "keyword"

  // Run legs in parallel with independent timeouts
  const [semanticResults, keywordResults, justificationResults] = await Promise.all([
    runSemantic
      ? runSemanticLeg(input, container).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          degraded.semantic = `pgvector search failed: ${msg}`
          return [] as RankedItem[]
        })
      : Promise.resolve([] as RankedItem[]),
    runKeyword
      ? runKeywordLeg(input, container).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          degraded.keyword = `ArangoDB fulltext failed: ${msg}`
          return [] as RankedItem[]
        })
      : Promise.resolve([] as RankedItem[]),
    runSemantic
      ? runJustificationLeg(input, container).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          degraded.justification = `justification search failed: ${msg}`
          return [] as RankedItem[]
        })
      : Promise.resolve([] as RankedItem[]),
  ])

  // If all legs failed, return error
  if (semanticResults.length === 0 && keywordResults.length === 0 && justificationResults.length === 0) {
    if (Object.keys(degraded).length > 0) {
      return {
        results: [],
        meta: {
          mode: input.mode,
          totalResults: 0,
          queryTimeMs: Date.now() - startTime,
          degraded,
        },
      }
    }
  }

  // Merge with Weighted RRF (k=30, semantic=0.7, keyword=1.0, justification=0.5)
  // Code search favors exact lexical matches — keyword leg gets higher weight.
  // Justification leg adds business-purpose context for intent-based queries.
  const queryTokens = tokenizeQuery(input.query)
  const rankings: RankedItem[][] = []
  const weights: number[] = []
  if (semanticResults.length > 0) {
    rankings.push(semanticResults)
    weights.push(0.7) // Semantic leg weight
  }
  if (keywordResults.length > 0) {
    rankings.push(keywordResults)
    weights.push(1.0) // Keyword leg weight — favors exact naming
  }
  if (justificationResults.length > 0) {
    rankings.push(justificationResults)
    weights.push(0.5) // Justification leg weight — business purpose context
  }

  // If only one leg, just use that ranking directly
  const merged = rankings.length > 0
    ? reciprocalRankFusion(rankings, queryTokens, 30, input.limit, weights)
    : []

  // Graph enrichment with timeout
  let enrichedResults: SearchResultItem[]
  try {
    enrichedResults = await withTimeout(
      enrichWithGraph(merged, input.orgId, container),
      2000
    )
  } catch {
    degraded.graphEnrichment = "ArangoDB graph enrichment timeout"
    enrichedResults = merged.map((item) => ({
      ...item,
      callers: undefined,
      callees: undefined,
    }))
  }

  return {
    results: enrichedResults,
    meta: {
      mode: input.mode,
      totalResults: enrichedResults.length,
      queryTimeMs: Date.now() - startTime,
      ...(Object.keys(degraded).length > 0 ? { degraded } : {}),
    },
  }
}

// ── Semantic Leg ──────────────────────────────────────────────────────────────

async function runSemanticLeg(
  input: HybridSearchInput,
  container: Container
): Promise<RankedItem[]> {
  // Embed the query
  let queryEmbedding: number[]
  if (container.vectorSearch.embedQuery) {
    queryEmbedding = await container.vectorSearch.embedQuery(input.query)
  } else {
    const embeddings = await container.vectorSearch.embed([input.query])
    queryEmbedding = embeddings[0]!
  }

  // Search pgvector
  const results = await container.vectorSearch.search(
    queryEmbedding,
    20, // top 20 candidates for RRF merge
    { orgId: input.orgId, repoId: input.repoId }
  )

  return results.map((r) => ({
    entityKey: r.id,
    entityName: (r.metadata?.entityName as string) ?? r.id,
    entityType: (r.metadata?.entityType as string) ?? "unknown",
    filePath: (r.metadata?.filePath as string) ?? "",
    score: r.score,
  }))
}

// ── Justification Leg ─────────────────────────────────────────────────────────

/**
 * Search the dedicated justification_embeddings table for business-purpose matches.
 * This leg surfaces entities whose justification (taxonomy, purpose, domain concepts)
 * matches the query, even when the entity's code/name doesn't match directly.
 */
async function runJustificationLeg(
  input: HybridSearchInput,
  container: Container
): Promise<RankedItem[]> {
  if (!container.vectorSearch.searchJustificationEmbeddings) {
    return []
  }

  // Embed the query
  let queryEmbedding: number[]
  if (container.vectorSearch.embedQuery) {
    queryEmbedding = await container.vectorSearch.embedQuery(input.query)
  } else {
    const embeddings = await container.vectorSearch.embed([input.query])
    queryEmbedding = embeddings[0]!
  }

  const results = await container.vectorSearch.searchJustificationEmbeddings(
    queryEmbedding,
    15, // top 15 candidates for RRF merge
    { orgId: input.orgId, repoId: input.repoId }
  )

  return results.map((r) => ({
    entityKey: r.entityId,
    entityName: r.entityName,
    entityType: r.taxonomy.toLowerCase(),
    filePath: "", // Justification results don't carry file path — will be enriched by graph
    score: r.score,
  }))
}

// ── Keyword Leg ───────────────────────────────────────────────────────────────

async function runKeywordLeg(
  input: HybridSearchInput,
  container: Container
): Promise<RankedItem[]> {
  const results = await container.graphStore.searchEntities(
    input.orgId,
    input.repoId,
    input.query,
    20 // top 20 candidates for RRF merge
  )

  return results.map((r) => ({
    entityKey: r.name, // searchEntities returns name, not key — use name as key for matching
    entityName: r.name,
    entityType: r.kind,
    filePath: r.file_path,
    lineStart: r.line,
    signature: r.signature,
    score: r.score,
  }))
}

// ── Graph Enrichment ──────────────────────────────────────────────────────────

/**
 * Enrich search results with graph context (callers, callees).
 * Fetches 1-hop caller/callee names for each result.
 */
async function enrichWithGraph(
  items: RankedItem[],
  orgId: string,
  container: Container
): Promise<SearchResultItem[]> {
  const enriched: SearchResultItem[] = []

  // Process in parallel for efficiency
  const promises = items.map(async (item) => {
    let callers: string[] = []
    let callees: string[] = []

    try {
      const [callersResult, calleesResult] = await Promise.all([
        container.graphStore.getCallersOf(orgId, item.entityKey).catch(() => [] as EntityDoc[]),
        container.graphStore.getCalleesOf(orgId, item.entityKey).catch(() => [] as EntityDoc[]),
      ])
      callers = callersResult.map((e) => e.name).slice(0, 5)
      callees = calleesResult.map((e) => e.name).slice(0, 5)
    } catch {
      // Graph enrichment failure is non-fatal
    }

    return {
      entityKey: item.entityKey,
      entityName: item.entityName,
      entityType: item.entityType,
      filePath: item.filePath,
      lineStart: item.lineStart,
      signature: item.signature,
      score: item.score,
      callers,
      callees,
    } satisfies SearchResultItem
  })

  const results = await Promise.all(promises)
  enriched.push(...results)

  return enriched
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}
