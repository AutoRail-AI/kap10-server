export interface IVectorSearch {
  embed(texts: string[]): Promise<number[][]>
  search(embedding: number[], topK: number, filter?: { orgId?: string; repoId?: string }): Promise<{ id: string; score: number }[]>
  upsert(ids: string[], embeddings: number[][], metadata: Record<string, unknown>[]): Promise<void>
}
