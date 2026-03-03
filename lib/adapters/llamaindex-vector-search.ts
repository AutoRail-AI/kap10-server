/**
 * IVectorSearch implementation using:
 *   - HuggingFace TEI (Text Embeddings Inference) for embedding via HTTP
 *   - pgvector (Supabase PostgreSQL) for vector storage and similarity search
 *
 * Phase 3: Semantic Search
 *
 * The embedding model (nomic-embed-text-v1.5) runs in a dedicated TEI container.
 * TEI handles batching, GPU acceleration, and concurrency — all production-optimized in Rust.
 */

import type { IVectorSearch } from "@/lib/ports/vector-search"

/** TEI endpoint — defaults to local Docker container on port 8090. */
const TEI_URL = process.env.TEI_URL ?? "http://localhost:8090"

/** TEI reranker endpoint — defaults to local Docker container on port 8091. */
const TEI_RERANKER_URL = process.env.TEI_RERANKER_URL ?? "http://localhost:8091"

/** Max texts per HTTP batch to TEI. Keeps request payloads reasonable. */
const TEI_BATCH_SIZE = parseInt(process.env.TEI_BATCH_SIZE ?? "32", 10)

/** Max retry attempts for TEI HTTP calls on 5xx / network errors. */
const TEI_MAX_RETRIES = 3

/** Backoff delays (ms) between retries. */
const TEI_RETRY_DELAYS = [1000, 3000, 9000]

/**
 * Call TEI's /embed endpoint with retry on 5xx / network errors.
 */
async function teiEmbed(inputs: string | string[], truncate = true): Promise<number[][]> {
  const body = JSON.stringify({ inputs, truncate })

  for (let attempt = 0; attempt < TEI_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${TEI_URL}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })

      if (res.ok) {
        return (await res.json()) as number[][]
      }

      // Retry on 5xx, throw on 4xx
      if (res.status >= 500) {
        const text = await res.text().catch(() => "")
        const isLast = attempt === TEI_MAX_RETRIES - 1
        if (isLast) {
          throw new Error(`TEI /embed returned ${res.status}: ${text}`)
        }
        console.warn(
          `[embedding] TEI /embed returned ${res.status} (attempt ${attempt + 1}/${TEI_MAX_RETRIES}). Retrying...`
        )
        await new Promise((r) => setTimeout(r, TEI_RETRY_DELAYS[attempt]!))
        continue
      }

      // 4xx — don't retry
      const text = await res.text().catch(() => "")
      throw new Error(`TEI /embed returned ${res.status}: ${text}`)
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith("TEI /embed returned")) {
        throw error
      }
      // Network error — retry
      const isLast = attempt === TEI_MAX_RETRIES - 1
      if (isLast) {
        throw new Error(
          `TEI /embed unreachable after ${TEI_MAX_RETRIES} attempts. ` +
          `Is the TEI container running at ${TEI_URL}? ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      console.warn(
        `[embedding] TEI /embed network error (attempt ${attempt + 1}/${TEI_MAX_RETRIES}): ` +
        `${error instanceof Error ? error.message : String(error)}. Retrying...`
      )
      await new Promise((r) => setTimeout(r, TEI_RETRY_DELAYS[attempt]!))
    }
  }

  // Unreachable — last attempt throws
  throw new Error("TEI /embed failed")
}

/**
 * Call TEI's /rerank endpoint with retry on 5xx / network errors.
 * Uses the same retry pattern as teiEmbed().
 */
async function teiRerank(
  query: string,
  texts: string[],
  topK: number
): Promise<{ index: number; score: number }[]> {
  const body = JSON.stringify({ query, texts, truncate: true })

  for (let attempt = 0; attempt < TEI_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${TEI_RERANKER_URL}/rerank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })

      if (res.ok) {
        const results = (await res.json()) as { index: number; score: number }[]
        // Sort by score descending and slice to topK
        return results
          .sort((a, b) => b.score - a.score)
          .slice(0, topK)
      }

      // Retry on 5xx, throw on 4xx
      if (res.status >= 500) {
        const text = await res.text().catch(() => "")
        const isLast = attempt === TEI_MAX_RETRIES - 1
        if (isLast) {
          throw new Error(`TEI /rerank returned ${res.status}: ${text}`)
        }
        console.warn(
          `[reranker] TEI /rerank returned ${res.status} (attempt ${attempt + 1}/${TEI_MAX_RETRIES}). Retrying...`
        )
        await new Promise((r) => setTimeout(r, TEI_RETRY_DELAYS[attempt]!))
        continue
      }

      // 4xx — don't retry
      const text = await res.text().catch(() => "")
      throw new Error(`TEI /rerank returned ${res.status}: ${text}`)
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith("TEI /rerank returned")) {
        throw error
      }
      // Network error — retry
      const isLast = attempt === TEI_MAX_RETRIES - 1
      if (isLast) {
        throw new Error(
          `TEI /rerank unreachable after ${TEI_MAX_RETRIES} attempts. ` +
          `Is the TEI reranker container running at ${TEI_RERANKER_URL}? ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      console.warn(
        `[reranker] TEI /rerank network error (attempt ${attempt + 1}/${TEI_MAX_RETRIES}): ` +
        `${error instanceof Error ? error.message : String(error)}. Retrying...`
      )
      await new Promise((r) => setTimeout(r, TEI_RETRY_DELAYS[attempt]!))
    }
  }

  // Unreachable — last attempt throws
  throw new Error("TEI /rerank failed")
}

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
   * Get the target embedding dimensions.
   * nomic-embed-text-v1.5 supports Matryoshka Representation Learning —
   * vectors can be truncated to 256/384/512 dims with negligible quality loss.
   * Set EMBEDDING_DIMENSIONS to a smaller value to save ~66% storage.
   */
  private getTargetDimensions(): number {
    return parseInt(process.env.EMBEDDING_DIMENSIONS ?? "768", 10)
  }

  /**
   * Truncate and re-normalize a vector for Matryoshka dimensions.
   * Only truncates if target < native 768 dims.
   */
  private truncateVector(vec: number[]): number[] {
    const targetDims = this.getTargetDimensions()
    if (targetDims >= vec.length) return vec

    // Slice to target dimensions
    const truncated = vec.slice(0, targetDims)
    // Re-normalize after truncation (required for cosine similarity correctness)
    let norm = 0
    for (let i = 0; i < truncated.length; i++) {
      norm += truncated[i]! * truncated[i]!
    }
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < truncated.length; i++) {
        truncated[i] = truncated[i]! / norm
      }
    }
    return truncated
  }

  /**
   * Embed texts using TEI (nomic-embed-text-v1.5).
   * Batches into TEI_BATCH_SIZE chunks, prefixes each text with "search_document: ".
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const allEmbeddings: number[][] = []

    // Process in batches to avoid overwhelming TEI with huge payloads
    for (let i = 0; i < texts.length; i += TEI_BATCH_SIZE) {
      const batch = texts.slice(i, i + TEI_BATCH_SIZE)
      // Prefix with "search_document: " for nomic model (document encoding convention)
      const prefixed = batch.map((t) => `search_document: ${t}`)

      const vectors = await teiEmbed(prefixed)

      for (const vec of vectors) {
        allEmbeddings.push(this.truncateVector(vec))
      }
    }

    return allEmbeddings
  }

  /**
   * Embed a query text (uses "search_query: " prefix for nomic model).
   * Applies same Matryoshka truncation as document encoding.
   */
  async embedQuery(text: string): Promise<number[]> {
    const vectors = await teiEmbed(`search_query: ${text}`)
    return this.truncateVector(vectors[0]!)
  }

  /**
   * Get the current model version string for embedding provenance.
   * Format: "{model-name}-{dimensions}" e.g. "nomic-v1.5-768" or "nomic-v1.5-256"
   * Override via EMBEDDING_MODEL_VERSION env var for custom model deployments.
   */
  private getModelVersion(): string {
    if (process.env.EMBEDDING_MODEL_VERSION) return process.env.EMBEDDING_MODEL_VERSION
    const dims = this.getTargetDimensions()
    return `nomic-v1.5-${dims}`
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

    const pool = getPgPool()
    const modelVersion = this.getModelVersion()

    // Use a single transaction for batch upsert
    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      for (let i = 0; i < ids.length; i++) {
        const meta = metadata[i]!
        const embedding = embeddings[i]!
        const vectorStr = `[${embedding.join(",")}]`

        await client.query(
          `INSERT INTO unerr.entity_embeddings
            (org_id, repo_id, entity_key, entity_type, entity_name, file_path, text_content, model_version, embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
          ON CONFLICT (repo_id, entity_key, model_version) DO UPDATE SET
            org_id = EXCLUDED.org_id,
            entity_type = EXCLUDED.entity_type,
            entity_name = EXCLUDED.entity_name,
            file_path = EXCLUDED.file_path,
            text_content = EXCLUDED.text_content,
            embedding = EXCLUDED.embedding,
            updated_at = now()`,
          [
            meta.orgId as string,
            meta.repoId as string,
            meta.entityKey as string,
            meta.entityType as string,
            meta.entityName as string,
            meta.filePath as string,
            meta.textContent as string,
            modelVersion,
            vectorStr,
          ]
        )
      }

      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK")
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
    const pool = getPgPool()
    const modelVersion = this.getModelVersion()

    if (currentEntityKeys.length === 0) {
      // No current entities = delete all embeddings for this repo + model version
      const result = await pool.query(
        `DELETE FROM unerr.entity_embeddings WHERE repo_id = $1 AND model_version = $2`,
        [repoId, modelVersion]
      )
      return result.rowCount ?? 0
    }

    // Use ANY with array parameter for IN clause
    const result = await pool.query(
      `DELETE FROM unerr.entity_embeddings
       WHERE repo_id = $1 AND model_version = $2 AND entity_key != ALL($3)`,
      [repoId, modelVersion, currentEntityKeys]
    )
    return result.rowCount ?? 0
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
    const client = await pool.connect()

    try {
      await client.query("BEGIN")

      for (let i = 0; i < embeddings.length; i++) {
        const meta = metadata[i]!
        const embedding = embeddings[i]!
        const vectorStr = `[${embedding.join(",")}]`

        await client.query(
          `INSERT INTO unerr.justification_embeddings
            (org_id, repo_id, entity_id, entity_name, taxonomy, feature_tag, business_purpose, model_version, embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
          ON CONFLICT (repo_id, entity_id, model_version) DO UPDATE SET
            org_id = EXCLUDED.org_id,
            entity_name = EXCLUDED.entity_name,
            taxonomy = EXCLUDED.taxonomy,
            feature_tag = EXCLUDED.feature_tag,
            business_purpose = EXCLUDED.business_purpose,
            embedding = EXCLUDED.embedding,
            updated_at = now()`,
          [
            meta.orgId,
            meta.repoId,
            meta.entityId,
            meta.entityName,
            meta.taxonomy,
            meta.featureTag,
            meta.businessPurpose,
            modelVersion,
            vectorStr,
          ]
        )
      }

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

  // ── Cross-Encoder Reranking ─────────────────────────────────────────────────

  /**
   * Re-score (query, document) pairs using the TEI cross-encoder reranker.
   * Delegates to teiRerank() which handles retries and sorting.
   */
  async rerank(
    query: string,
    documents: string[],
    topK: number
  ): Promise<{ index: number; score: number }[]> {
    return teiRerank(query, documents, topK)
  }
}
