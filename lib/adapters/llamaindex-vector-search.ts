/**
 * Stub IVectorSearch (Phase 0). Phase 4+ will implement with LlamaIndex + pgvector.
 */

import type { IVectorSearch } from "@/lib/ports/vector-search"
import { NotImplementedError } from "./errors"

export class LlamaIndexVectorSearch implements IVectorSearch {
  async embed(): Promise<number[][]> {
    throw new NotImplementedError("IVectorSearch.embed not implemented in Phase 0")
  }

  async search(): Promise<{ id: string; score: number }[]> {
    throw new NotImplementedError("IVectorSearch.search not implemented in Phase 0")
  }

  async upsert(): Promise<void> {
    throw new NotImplementedError("IVectorSearch.upsert not implemented in Phase 0")
  }
}
