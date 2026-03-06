import type { OrgContext, TokenUsage } from "./types"

export interface BatchProcessingOptions<TItem, TResult> {
  model: string
  items: TItem[]
  /** Build a prompt for a batch of items */
  buildPrompt: (items: TItem[]) => string
  /** Build a prompt for a single item (used as fallback) */
  buildSinglePrompt: (item: TItem) => string
  /** Schema for single-item result */
  schema: { parse: (v: unknown) => TResult }
  /** Schema for batch result (wraps array of TResult) */
  batchSchema: { parse: (v: unknown) => { results: TResult[] } }
  /** Match a result back to its source item (e.g., by entityId) */
  matchResult: (item: TItem, result: TResult) => boolean
  system?: string
  context?: OrgContext
  temperature?: number
  /** Max concurrent LLM calls. Default: LLM_BATCH_CONCURRENCY env var or 10 */
  maxConcurrency?: number
  /** Max items per single LLM batch call. Default: LLM_MAX_ITEMS_PER_BATCH env var or 8 */
  maxItemsPerBatch?: number
  /** Progress callback for heartbeats */
  onProgress?: (msg: string) => void
}

export interface BatchProcessingResult<TItem, TResult> {
  /** Successful results mapped by item */
  results: Map<TItem, TResult>
  /** Items that failed all retries */
  failures: TItem[]
}

export interface ILLMProvider {
  generateObject<T>(params: {
    model: string
    schema: { parse: (v: unknown) => T }
    prompt: string
    system?: string
    context?: OrgContext
    temperature?: number
  }): Promise<{ object: T; usage: TokenUsage }>

  streamText(params: {
    model: string
    prompt: string
    context?: OrgContext
  }): AsyncIterable<string>

  embed(params: { model: string; texts: string[] }): Promise<number[][]>

  generateBatchObjects<TItem, TResult>(
    params: BatchProcessingOptions<TItem, TResult>
  ): Promise<BatchProcessingResult<TItem, TResult>>
}
