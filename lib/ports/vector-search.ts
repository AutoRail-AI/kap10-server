/**
 * Vector search port — embedding generation, storage, and similarity search.
 * Phase 3: Semantic Search via nomic-embed-text-v1.5 + pgvector.
 */

export interface VectorSearchResult {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

export interface IVectorSearch {
  /** Embed texts into vectors (document encoding). */
  embed(texts: string[]): Promise<number[][]>
  /** Embed a single query text (query encoding — may use different prefix). */
  embedQuery?(text: string): Promise<number[]>
  /** Upsert embeddings with metadata into the vector store. */
  upsert(ids: string[], embeddings: number[][], metadata: Record<string, unknown>[]): Promise<void>
  /** Search for similar vectors. Returns entity keys + scores. */
  search(embedding: number[], topK: number, filter?: { orgId?: string; repoId?: string }): Promise<VectorSearchResult[]>
  /** Look up an existing embedding by entity key. */
  getEmbedding?(repoId: string, entityKey: string): Promise<number[] | null>
  /** Delete orphaned embeddings (entities removed from graph). Returns count deleted. */
  deleteOrphaned?(repoId: string, currentEntityKeys: string[]): Promise<number>
}
