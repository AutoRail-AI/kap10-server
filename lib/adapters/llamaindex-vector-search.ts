/**
 * IVectorSearch implementation using:
 *   - @xenova/transformers (nomic-embed-text-v1.5) for local CPU embedding
 *   - pgvector (Supabase PostgreSQL) for vector storage and similarity search
 *
 * Phase 3: Semantic Search
 */

import type { IVectorSearch } from "@/lib/ports/vector-search"

// Lazy-loaded singleton for the embedding pipeline
let pipelineInstance: EmbeddingPipeline | null = null

interface EmbeddingOutput {
  tolist(): number[][]
  data: Float32Array
  dims: number[]
  dispose?: () => void
}

interface EmbeddingPipeline {
  (texts: string | string[], options: Record<string, unknown>): Promise<EmbeddingOutput>
}

/**
 * Max tokens per ONNX inference call. CRITICAL for memory safety:
 * ONNX attention matrices scale O(n²) — at 8192 tokens that's ~1.7GB per layer.
 * At 512 tokens: ~12MB per layer. Default 512 keeps peak inference ≈ 200MB.
 * Override via EMBEDDING_MAX_TOKENS env var.
 */
const EMBEDDING_MAX_TOKENS = parseInt(process.env.EMBEDDING_MAX_TOKENS ?? "512", 10)

/**
 * Get or create the embedding pipeline singleton.
 * The model (~500MB ONNX) is downloaded on first call and cached at ~/.cache/huggingface/.
 */
async function getEmbeddingPipeline(): Promise<EmbeddingPipeline> {
  if (pipelineInstance) return pipelineInstance

  const modelName = process.env.EMBEDDING_MODEL_NAME ?? "nomic-ai/nomic-embed-text-v1.5"

  // Dynamic import to avoid loading at build time
  const { pipeline, env } = await import("@xenova/transformers")

  // Limit ONNX WASM threads to reduce memory pressure
  env.backends.onnx.wasm.numThreads = 1

  pipelineInstance = (await pipeline("feature-extraction", modelName)) as unknown as EmbeddingPipeline
  return pipelineInstance
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
   * Embed texts using nomic-embed-text-v1.5 (local CPU, 768-dim native).
   *
   * CRITICAL MEMORY DESIGN: Processes ONE document at a time.
   * ONNX attention matrices scale O(n²) with sequence length — batching multiple
   * long documents causes multi-GB WASM allocations that OOM the container.
   * Single-doc processing with token truncation caps peak inference at ~200MB.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const pipe = await getEmbeddingPipeline()
    const allEmbeddings: number[][] = []

    // Process ONE document at a time to cap ONNX WASM memory.
    // Token truncation + single-doc inference keeps peak at ~200MB vs multi-GB.
    for (let i = 0; i < texts.length; i++) {
      // Prefix with "search_document: " for nomic model (document encoding)
      const prefixed = `search_document: ${texts[i]}`
      const output = await pipe(prefixed, {
        pooling: "mean",
        normalize: true,
        // Truncate at tokenizer level — prevents quadratic attention blowup
        truncation: true,
        max_length: EMBEDDING_MAX_TOKENS,
      })
      const vectors = output.tolist()
      allEmbeddings.push(this.truncateVector(vectors[0]!))

      // Dispose ONNX tensors to free WASM memory immediately
      if (output.dispose) output.dispose()

      // Force GC every 5 docs to reclaim any JS-side references
      if (i > 0 && i % 5 === 0 && global.gc) global.gc()
    }

    return allEmbeddings
  }

  /**
   * Embed a query text (uses "search_query: " prefix for nomic model).
   * Applies same Matryoshka truncation as document encoding.
   */
  async embedQuery(text: string): Promise<number[]> {
    const pipe = await getEmbeddingPipeline()
    const output = await pipe(`search_query: ${text}`, {
      pooling: "mean",
      normalize: true,
      truncation: true,
      max_length: EMBEDDING_MAX_TOKENS,
    })
    const vectors = output.tolist()
    if (output.dispose) output.dispose()
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
}
