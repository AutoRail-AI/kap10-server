/**
 * IVectorSearch implementation using:
 *   - Google Vertex AI Gemini Embedding 001 for embedding (768 dims, configurable)
 *   - AWS Bedrock Cohere Rerank 3.5 for cross-encoder reranking
 *   - pgvector (Supabase PostgreSQL) for vector storage and similarity search
 *
 * Phase 3: Semantic Search
 */

import type { IVectorSearch } from "@/lib/ports/vector-search"
import { EMBEDDING_MODEL_ID, EMBEDDING_DIMENSIONS, GOOGLE_VERTEX_API_KEY, RERANKER_MODEL_ID, AWS_REGION } from "@/lib/llm/config"

// ── Lazy Vertex AI Embedding ────────────────────────────────────────────────

let _vertexProvider: ReturnType<typeof import("@ai-sdk/google-vertex").createVertex> | null = null

function getVertexProvider() {
  if (_vertexProvider) return _vertexProvider
  const { createVertex } = require("@ai-sdk/google-vertex") as typeof import("@ai-sdk/google-vertex")
  const apiKey = GOOGLE_VERTEX_API_KEY
  if (!apiKey) {
    throw new Error("GOOGLE_VERTEX_API_KEY is required for Vertex AI embedding")
  }
  _vertexProvider = createVertex({ apiKey })
  return _vertexProvider
}

/**
 * Batch embedding using AI SDK's embedMany().
 *
 * gemini-embedding-001 on Vertex AI supports up to 250 texts per request
 * (API rejects >= 251 despite SDK reporting maxEmbeddingsPerCall=2048).
 * embedMany() sends all texts in a SINGLE HTTP request per chunk.
 *
 * For 250 texts: 1 HTTP request (~200-500ms) instead of 250 requests (~25s).
 *
 * We chunk into EMBED_BATCH_SIZE (250) and run up to EMBED_PARALLEL_BATCHES
 * concurrent chunk requests for throughput.
 */
const EMBED_BATCH_SIZE = 250 // Vertex AI actual limit is 251 exclusive (SDK reports 2048 but API rejects >= 251)
const EMBED_PARALLEL_BATCHES = 3
const EMBED_MAX_RETRIES = 5

async function vertexEmbed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[][]> {
  if (texts.length === 0) return []
  const { embedMany } = require("ai") as typeof import("ai")
  const { logger: log } = require("@/lib/utils/logger") as typeof import("@/lib/utils/logger")
  const vertex = getVertexProvider()
  const model = vertex.textEmbeddingModel(EMBEDDING_MODEL_ID)

  const totalChars = texts.reduce((sum, t) => sum + t.length, 0)
  log.info("vertexEmbed: starting batch embedding", {
    service: "vector-search",
    textCount: texts.length,
    totalChars,
    avgCharsPerText: Math.round(totalChars / texts.length),
    taskType,
    batchSize: EMBED_BATCH_SIZE,
  })
  const overallStart = Date.now()

  // Chunk texts into batches of EMBED_BATCH_SIZE
  const chunks: string[][] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    chunks.push(texts.slice(i, i + EMBED_BATCH_SIZE))
  }

  const allEmbeddings: number[][] = []

  // Process chunks with bounded parallelism
  for (let windowStart = 0; windowStart < chunks.length; windowStart += EMBED_PARALLEL_BATCHES) {
    const windowEnd = Math.min(windowStart + EMBED_PARALLEL_BATCHES, chunks.length)
    const batchPromises = []

    for (let ci = windowStart; ci < windowEnd; ci++) {
      const chunk = chunks[ci]!
      batchPromises.push(
        (async (chunkIndex: number, chunkTexts: string[]): Promise<number[][]> => {
          for (let attempt = 0; attempt <= EMBED_MAX_RETRIES; attempt++) {
            try {
              const chunkStart = Date.now()
              const { embeddings } = await embedMany({
                model,
                values: chunkTexts,
                providerOptions: {
                  vertex: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
                },
              })
              const chunkMs = Date.now() - chunkStart
              log.info("vertexEmbed: chunk complete", {
                service: "vector-search",
                chunk: `${chunkIndex + 1}/${chunks.length}`,
                textsInChunk: chunkTexts.length,
                embeddingsReturned: embeddings.length,
                durationMs: chunkMs,
                textsPerSec: Math.round((chunkTexts.length / chunkMs) * 1000),
              })
              return embeddings
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err)
              if ((msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) && attempt < EMBED_MAX_RETRIES) {
                const backoffMs = 1000 * Math.pow(2, attempt)
                log.warn("vertexEmbed: rate limited, backing off", {
                  service: "vector-search",
                  chunk: `${chunkIndex + 1}/${chunks.length}`,
                  attempt: attempt + 1,
                  backoffMs,
                })
                await new Promise((r) => setTimeout(r, backoffMs))
                continue
              }
              throw new Error(`Embedding chunk ${chunkIndex + 1}/${chunks.length} failed: ${msg}`)
            }
          }
          throw new Error(`Embedding chunk failed after ${EMBED_MAX_RETRIES} retries`)
        })(ci, chunk)
      )
    }

    const batchResults = await Promise.all(batchPromises)
    for (const embeddings of batchResults) {
      allEmbeddings.push(...embeddings)
    }
  }

  const totalMs = Date.now() - overallStart
  log.info("vertexEmbed: all chunks complete", {
    service: "vector-search",
    totalTexts: texts.length,
    totalEmbeddings: allEmbeddings.length,
    totalDurationMs: totalMs,
    textsPerSec: Math.round((texts.length / totalMs) * 1000),
    chunksUsed: chunks.length,
  })

  return allEmbeddings
}

// ── Lazy Bedrock Provider (reranking only) ──────────────────────────────────

let _bedrockProvider: ReturnType<typeof import("@ai-sdk/amazon-bedrock").createAmazonBedrock> | null = null

function getBedrockProvider() {
  if (_bedrockProvider) return _bedrockProvider
  const { createAmazonBedrock } = require("@ai-sdk/amazon-bedrock") as typeof import("@ai-sdk/amazon-bedrock")
  _bedrockProvider = createAmazonBedrock({ region: AWS_REGION })
  return _bedrockProvider
}

// ── pgvector Pool ───────────────────────────────────────────────────────────

/**
 * Get a pg Pool lazily (production use only — reuses the Supabase DB connection).
 */
let pgPool: import("pg").Pool | null = null

function getPgPool(): import("pg").Pool {
  if (pgPool) return pgPool
  const { Pool } = require("pg") as typeof import("pg")
  const connectionString = process.env.SUPABASE_DB_URL
  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL is required for vector search")
  }
  pgPool = new Pool({ connectionString, max: 5 })
  return pgPool
}

export class LlamaIndexVectorSearch implements IVectorSearch {
  /**
   * Embed texts using Vertex AI Gemini Embedding 001 (document encoding).
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    return vertexEmbed(texts, "RETRIEVAL_DOCUMENT")
  }

  /**
   * Embed a single query text (query encoding).
   */
  async embedQuery(text: string): Promise<number[]> {
    const vectors = await vertexEmbed([text], "RETRIEVAL_QUERY")
    return vectors[0]!
  }

  /**
   * Get the current model version string for embedding provenance.
   * Override via EMBEDDING_MODEL_VERSION env var for custom model deployments.
   */
  private getModelVersion(): string {
    if (process.env.EMBEDDING_MODEL_VERSION) return process.env.EMBEDDING_MODEL_VERSION
    return "gemini-emb-001-768"
  }

  /**
   * Upsert embeddings into pgvector (unerr.entity_embeddings).
   * Uses ON CONFLICT (repo_id, entity_key, model_version) DO UPDATE for
   * version-aware idempotent upserts. Model version enables zero-downtime
   * blue/green re-embedding on model upgrades.
   */
  async upsert(
    ids: string[],
    embeddings: number[][],
    metadata: Record<string, unknown>[]
  ): Promise<void> {
    if (ids.length === 0) return

    const { logger: log } = require("@/lib/utils/logger") as typeof import("@/lib/utils/logger")
    const pool = getPgPool()
    const modelVersion = this.getModelVersion()

    // Multi-row INSERT — one SQL statement per batch instead of N round-trips.
    // Deduplicate by entity_key within the batch (last-write-wins) to avoid
    // PostgreSQL's "ON CONFLICT DO UPDATE cannot affect row a second time" error.
    const deduped = new Map<string, number>()
    for (let i = 0; i < ids.length; i++) {
      const key = metadata[i]!.entityKey as string
      deduped.set(key, i)
    }
    const uniqueIndices = [...deduped.values()]
    const dedupedCount = ids.length - uniqueIndices.length

    if (dedupedCount > 0) {
      log.info("pgvector upsert: deduped within batch", {
        service: "vector-search",
        inputRows: ids.length,
        uniqueRows: uniqueIndices.length,
        dedupedCount,
      })
    }

    if (uniqueIndices.length === 0) return

    const startMs = Date.now()
    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      const valuePlaceholders: string[] = []
      const params: unknown[] = []

      for (let ri = 0; ri < uniqueIndices.length; ri++) {
        const i = uniqueIndices[ri]!
        const meta = metadata[i]!
        const embedding = embeddings[i]!
        const vectorStr = `[${embedding.join(",")}]`
        const base = ri * 9

        valuePlaceholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::vector)`
        )
        params.push(
          meta.orgId as string,
          meta.repoId as string,
          meta.entityKey as string,
          meta.entityType as string,
          meta.entityName as string,
          meta.filePath as string,
          meta.textContent as string,
          modelVersion,
          vectorStr,
        )
      }

      const result = await client.query(
        `INSERT INTO unerr.entity_embeddings
          (org_id, repo_id, entity_key, entity_type, entity_name, file_path, text_content, model_version, embedding)
        VALUES ${valuePlaceholders.join(", ")}
        ON CONFLICT (repo_id, entity_key, model_version) DO UPDATE SET
          org_id = EXCLUDED.org_id,
          entity_type = EXCLUDED.entity_type,
          entity_name = EXCLUDED.entity_name,
          file_path = EXCLUDED.file_path,
          text_content = EXCLUDED.text_content,
          embedding = EXCLUDED.embedding,
          updated_at = now()`,
        params,
      )

      await client.query("COMMIT")
      const upsertMs = Date.now() - startMs

      log.info("pgvector upsert: committed", {
        service: "vector-search",
        rowsUpserted: uniqueIndices.length,
        rowsAffected: result.rowCount,
        modelVersion,
        upsertMs,
        paramCount: params.length,
      })
    } catch (err) {
      await client.query("ROLLBACK")
      const errMsg = err instanceof Error ? err.message : String(err)
      log.error("pgvector upsert: ROLLBACK", undefined, {
        service: "vector-search",
        error: errMsg,
        rowsAttempted: uniqueIndices.length,
      })
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Search for similar vectors using pgvector cosine distance.
   * Returns entity_key + score, scoped by orgId, repoId, and current model version.
   * Model version filter ensures queries only match embeddings from the same model.
   */
  async search(
    embedding: number[],
    topK: number,
    filter?: { orgId?: string; repoId?: string }
  ): Promise<{ id: string; score: number; metadata?: Record<string, unknown> }[]> {
    const pool = getPgPool()
    const vectorStr = `[${embedding.join(",")}]`
    const modelVersion = this.getModelVersion()

    // Build WHERE clause for multi-tenancy + model version
    const conditions: string[] = [`model_version = $3`]
    const params: unknown[] = [vectorStr, topK, modelVersion]
    let paramIndex = 4

    if (filter?.orgId) {
      conditions.push(`org_id = $${paramIndex}`)
      params.push(filter.orgId)
      paramIndex++
    }
    if (filter?.repoId) {
      conditions.push(`repo_id = $${paramIndex}`)
      params.push(filter.repoId)
      paramIndex++
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`

    const result = await pool.query(
      `SELECT entity_key, entity_type, entity_name, file_path,
              1 - (embedding <=> $1::vector) as score
       FROM unerr.entity_embeddings
       ${whereClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      params
    )

    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.entity_key as string,
      score: Number(row.score),
      metadata: {
        entityType: row.entity_type,
        entityName: row.entity_name,
        filePath: row.file_path,
      },
    }))
  }

  /**
   * Look up an existing embedding by entity key (current model version).
   */
  async getEmbedding(repoId: string, entityKey: string): Promise<number[] | null> {
    const pool = getPgPool()
    const modelVersion = this.getModelVersion()
    const result = await pool.query(
      `SELECT embedding::text FROM unerr.entity_embeddings
       WHERE repo_id = $1 AND entity_key = $2 AND model_version = $3`,
      [repoId, entityKey, modelVersion]
    )
    if (result.rows.length === 0) return null

    // Parse the vector string "[0.1,0.2,...]"
    const vecStr = result.rows[0].embedding as string
    return JSON.parse(vecStr) as number[]
  }

  /**
   * Delete orphaned embeddings for the current model version
   * (entities removed from graph but still in pgvector).
   */
  async deleteOrphaned(repoId: string, currentEntityKeys: string[]): Promise<number> {
    const { logger: log } = require("@/lib/utils/logger") as typeof import("@/lib/utils/logger")
    const pool = getPgPool()
    const modelVersion = this.getModelVersion()
    const startMs = Date.now()

    log.info("deleteOrphaned: starting", {
      service: "vector-search",
      repoId,
      currentEntityKeys: currentEntityKeys.length,
      modelVersion,
    })

    if (currentEntityKeys.length === 0) {
      const result = await pool.query(
        `DELETE FROM unerr.entity_embeddings WHERE repo_id = $1 AND model_version = $2`,
        [repoId, modelVersion]
      )
      const deleted = result.rowCount ?? 0
      log.info("deleteOrphaned: all embeddings deleted (no current keys)", {
        service: "vector-search",
        deletedCount: deleted,
        durationMs: Date.now() - startMs,
      })
      return deleted
    }

    // First count how many exist before deleting
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM unerr.entity_embeddings WHERE repo_id = $1 AND model_version = $2`,
      [repoId, modelVersion]
    )
    const totalBefore = parseInt(countResult.rows[0]?.total ?? "0", 10)

    const result = await pool.query(
      `DELETE FROM unerr.entity_embeddings
       WHERE repo_id = $1 AND model_version = $2 AND entity_key != ALL($3)`,
      [repoId, modelVersion, currentEntityKeys]
    )
    const deleted = result.rowCount ?? 0
    const durationMs = Date.now() - startMs

    log.info("deleteOrphaned: complete", {
      service: "vector-search",
      totalEmbeddingsBefore: totalBefore,
      currentValidKeys: currentEntityKeys.length,
      orphansDeleted: deleted,
      remainingAfter: totalBefore - deleted,
      durationMs,
    })
    return deleted
  }

  /**
   * Delete ALL entity embeddings for a repo (clean slate before re-index).
   */
  async deleteAllEmbeddings(repoId: string): Promise<number> {
    const { logger: log } = require("@/lib/utils/logger") as typeof import("@/lib/utils/logger")
    const pool = getPgPool()
    const startMs = Date.now()

    const result = await pool.query(
      `DELETE FROM unerr.entity_embeddings WHERE repo_id = $1`,
      [repoId]
    )
    const deleted = result.rowCount ?? 0
    log.info("deleteAllEmbeddings: complete", {
      service: "vector-search",
      repoId,
      deletedCount: deleted,
      durationMs: Date.now() - startMs,
    })
    return deleted
  }

  // ── Phase 4: Justification Embeddings (unerr.justification_embeddings) ──

  /**
   * Upsert justification embeddings into the dedicated justification_embeddings table.
   * Uses ON CONFLICT (repo_id, entity_id, model_version) for idempotent upserts.
   */
  async upsertJustificationEmbeddings(
    embeddings: number[][],
    metadata: import("@/lib/ports/vector-search").JustificationEmbeddingMeta[]
  ): Promise<void> {
    if (embeddings.length === 0) return

    const pool = getPgPool()
    const modelVersion = this.getModelVersion()

    // Deduplicate by entity_id within the batch (last-write-wins)
    const deduped = new Map<string, number>()
    for (let i = 0; i < metadata.length; i++) {
      deduped.set(metadata[i]!.entityId, i)
    }
    const uniqueIndices = [...deduped.values()]

    if (uniqueIndices.length === 0) return

    const client = await pool.connect()

    try {
      await client.query("BEGIN")

      const valuePlaceholders: string[] = []
      const params: unknown[] = []

      for (let ri = 0; ri < uniqueIndices.length; ri++) {
        const i = uniqueIndices[ri]!
        const meta = metadata[i]!
        const embedding = embeddings[i]!
        const vectorStr = `[${embedding.join(",")}]`
        const base = ri * 9

        valuePlaceholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::vector)`
        )
        params.push(
          meta.orgId,
          meta.repoId,
          meta.entityId,
          meta.entityName,
          meta.taxonomy,
          meta.featureTag,
          meta.businessPurpose,
          modelVersion,
          vectorStr,
        )
      }

      await client.query(
        `INSERT INTO unerr.justification_embeddings
          (org_id, repo_id, entity_id, entity_name, taxonomy, feature_tag, business_purpose, model_version, embedding)
        VALUES ${valuePlaceholders.join(", ")}
        ON CONFLICT (repo_id, entity_id, model_version) DO UPDATE SET
          org_id = EXCLUDED.org_id,
          entity_name = EXCLUDED.entity_name,
          taxonomy = EXCLUDED.taxonomy,
          feature_tag = EXCLUDED.feature_tag,
          business_purpose = EXCLUDED.business_purpose,
          embedding = EXCLUDED.embedding,
          updated_at = now()`,
        params,
      )

      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Search justification embeddings by semantic similarity.
   * Queries the dedicated justification_embeddings table with optional taxonomy filter.
   * Returns typed JustificationSearchResult[] with business context metadata.
   */
  async searchJustificationEmbeddings(
    embedding: number[],
    topK: number,
    filter: { orgId: string; repoId: string; taxonomy?: string }
  ): Promise<import("@/lib/ports/vector-search").JustificationSearchResult[]> {
    const pool = getPgPool()
    const vectorStr = `[${embedding.join(",")}]`
    const modelVersion = this.getModelVersion()

    const conditions: string[] = [
      `model_version = $3`,
      `org_id = $4`,
      `repo_id = $5`,
    ]
    const params: unknown[] = [vectorStr, topK, modelVersion, filter.orgId, filter.repoId]

    if (filter.taxonomy) {
      conditions.push(`taxonomy = $6`)
      params.push(filter.taxonomy)
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`

    const result = await pool.query(
      `SELECT entity_id, entity_name, taxonomy, feature_tag, business_purpose,
              1 - (embedding <=> $1::vector) as score
       FROM unerr.justification_embeddings
       ${whereClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      params
    )

    return result.rows.map((row: Record<string, unknown>) => ({
      entityId: row.entity_id as string,
      entityName: row.entity_name as string,
      taxonomy: row.taxonomy as string,
      featureTag: row.feature_tag as string,
      businessPurpose: row.business_purpose as string,
      score: Number(row.score),
    }))
  }

  /**
   * Delete all justification embeddings for a repo (cleanup on re-justification).
   */
  async deleteJustificationEmbeddings(repoId: string): Promise<number> {
    const pool = getPgPool()
    const modelVersion = this.getModelVersion()
    const result = await pool.query(
      `DELETE FROM unerr.justification_embeddings WHERE repo_id = $1 AND model_version = $2`,
      [repoId, modelVersion]
    )
    return result.rowCount ?? 0
  }

  // ── Reranking (Bedrock Cohere Rerank 3.5) ────────────────────────────────

  /**
   * Rerank documents by relevance to a query using Cohere Rerank 3.5 on Bedrock.
   * Returns indices + relevance scores sorted by relevance (highest first).
   */
  async rerank(
    query: string,
    documents: string[],
    topK: number
  ): Promise<{ index: number; relevanceScore: number }[]> {
    if (documents.length === 0) return []
    const { rerank } = require("ai") as typeof import("ai")
    const bedrock = getBedrockProvider()
    const model = bedrock.reranking(RERANKER_MODEL_ID)
    const { ranking } = await rerank({
      model,
      query,
      documents,
      topN: topK,
    })
    return ranking.map((r) => ({
      index: r.originalIndex,
      relevanceScore: r.score,
    }))
  }
}
