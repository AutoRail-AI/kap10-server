/**
 * Vector search port — embedding generation, storage, and similarity search.
 * Phase 3: Entity embeddings via nomic-embed-text-v1.5 + pgvector (entity_embeddings).
 * Phase 4: Justification embeddings for business-purpose search (justification_embeddings).
 */

export interface VectorSearchResult {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

/** Metadata for justification embedding upserts (maps to justification_embeddings columns). */
export interface JustificationEmbeddingMeta {
  orgId: string
  repoId: string
  entityId: string
  entityName: string
  taxonomy: string
  featureTag: string
  businessPurpose: string
}

/** Search result from justification embeddings with typed metadata. */
export interface JustificationSearchResult {
  entityId: string
  entityName: string
  taxonomy: string
  featureTag: string
  businessPurpose: string
  score: number
}

export interface IVectorSearch {
  // ── Phase 3: Entity Embeddings (unerr.entity_embeddings) ────────

  /** Embed texts into vectors (document encoding). */
  embed(texts: string[]): Promise<number[][]>
  /** Embed a single query text (query encoding — may use different prefix). */
  embedQuery?(text: string): Promise<number[]>
  /** Upsert entity embeddings with metadata into the vector store. */
  upsert(ids: string[], embeddings: number[][], metadata: Record<string, unknown>[]): Promise<void>
  /** Search for similar entity vectors. Returns entity keys + scores. */
  search(embedding: number[], topK: number, filter?: { orgId?: string; repoId?: string }): Promise<VectorSearchResult[]>
  /** Look up an existing embedding by entity key. */
  getEmbedding?(repoId: string, entityKey: string): Promise<number[] | null>
  /** Delete orphaned entity embeddings (entities removed from graph). Returns count deleted. */
  deleteOrphaned?(repoId: string, currentEntityKeys: string[]): Promise<number>

  // ── Phase 4: Justification Embeddings (unerr.justification_embeddings) ──

  /** Upsert justification embeddings into the dedicated justification_embeddings table. */
  upsertJustificationEmbeddings?(
    embeddings: number[][],
    metadata: JustificationEmbeddingMeta[]
  ): Promise<void>

  /** Search justification embeddings by semantic similarity, with optional taxonomy filter. */
  searchJustificationEmbeddings?(
    embedding: number[],
    topK: number,
    filter: { orgId: string; repoId: string; taxonomy?: string }
  ): Promise<JustificationSearchResult[]>

  /** Delete all justification embeddings for a repo (cleanup on re-justification). */
  deleteJustificationEmbeddings?(repoId: string): Promise<number>
}
