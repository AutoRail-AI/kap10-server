/**
 * Provider-agnostic batch processor for LLM calls.
 *
 * Responsibilities (batch-level orchestration only):
 *  - Token-budgeted batch packing (delegates to dynamic-batcher)
 *  - Parallel execution with bounded concurrency
 *  - Missing-item detection → re-batch in smaller groups
 *  - Parse failure → split batch in half
 *  - Fatal error detection (401/403/405) → abort early
 *  - Final single-item fallback for stragglers
 *
 * NOT responsible for (handled by the provider's per-call layer):
 *  - RPM/TPM rate limiting  → RateLimiter in bedrock-provider
 *  - Per-call retry on 429  → retryWithBackoff in bedrock-provider
 *  - Token budget pre-check → waitForTokenBudget in bedrock-provider
 *
 * ┌─────────────────────────────────────────────────────┐
 * │ PARAMETER DEPENDENCY NOTICE                         │
 * │                                                     │
 * │ Default values are tuned for AWS Bedrock & Google   │
 * │ Vertex AI with models like GPT-OSS, Qwen3, Gemini. │
 * │ When changing the underlying LLM provider or model, │
 * │ review and adjust these env vars:                   │
 * │                                                     │
 * │  LLM_RPM_LIMIT              (default: 120)         │
 * │  LLM_TPM_LIMIT              (default: auto-detect) │
 * │  LLM_BATCH_CONCURRENCY      (default: 10)          │
 * │  LLM_MAX_ITEMS_PER_BATCH    (default: 8)           │
 * │  LLM_BATCH_MAX_INPUT_TOKENS (default: 5000)        │
 * │  LLM_RETRY_MAX_ATTEMPTS     (default: 5)           │
 * │  LLM_RETRY_BASE_DELAY_MS    (default: 1000)        │
 * └─────────────────────────────────────────────────────┘
 */

import type { BatchProcessingOptions, BatchProcessingResult } from "@/lib/ports/llm-provider"

export interface BatchProcessorConfig {
  maxConcurrency: number
  maxItemsPerBatch: number
}

const FATAL_ERROR_PATTERNS = [
  "401", "unauthorized",
  "403", "forbidden",
  "405", "method not allowed",
  "invalid api key", "invalid_api_key",
  "model_not_found", "model not found",
]

export function getDefaultBatchConfig(): BatchProcessorConfig {
  const { getBatchConcurrency, getMaxItemsPerBatch } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")
  return {
    maxConcurrency: getBatchConcurrency(),
    maxItemsPerBatch: getMaxItemsPerBatch(),
  }
}

function isFatalError(message: string): boolean {
  const lower = message.toLowerCase()
  return FATAL_ERROR_PATTERNS.some((p) => lower.includes(p))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Split an array into chunks of at most `size` elements. */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/**
 * Run async functions with bounded concurrency.
 * Returns results in order, preserving index alignment.
 */
async function parallelMap<T, R>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIndex++
      if (idx >= items.length) return
      results[idx] = await fn(items[idx]!, idx)
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

interface BatchResult<TItem, TResult> {
  matched: Map<TItem, TResult>
  missing: TItem[]
}

/**
 * Process a list of items through an LLM with automatic batching and fallback.
 *
 * Per-call retry and rate limiting are NOT done here — the provider's
 * `generateObject()` already handles those via `RateLimiter` + `retryWithBackoff`.
 * This function only orchestrates batch-level concerns: packing, concurrency,
 * missing-item re-batching, parse-failure splitting, and fatal error abort.
 *
 * @param config - Batch processing configuration (concurrency, items per batch)
 * @param params - Items, prompts, schemas, and matching logic
 * @param callSingle - Provider LLM call for a single item (already has retry/rate-limit)
 * @param callBatch - Provider LLM call for a batch (already has retry/rate-limit)
 */
export async function processBatch<TItem, TResult>(
  config: BatchProcessorConfig,
  params: BatchProcessingOptions<TItem, TResult>,
  callSingle: (prompt: string) => Promise<TResult>,
  callBatch: (prompt: string) => Promise<{ results: TResult[] }>
): Promise<BatchProcessingResult<TItem, TResult>> {
  const allResults = new Map<TItem, TResult>()
  const { items, buildPrompt, buildSinglePrompt, matchResult, onProgress } = params

  if (items.length === 0) {
    return { results: allResults, failures: [] }
  }

  // Pack items into batches (simple item-count chunking — token-budgeted packing
  // is done upstream by dynamic-batcher when the caller uses createBatches)
  const batches = chunk(items, config.maxItemsPerBatch)
  onProgress?.(`processing ${items.length} items in ${batches.length} batches (concurrency: ${config.maxConcurrency})`)

  let consecutiveFatalErrors = 0
  const FATAL_THRESHOLD = 5

  // Process batches with bounded concurrency
  const batchResults = await parallelMap(
    batches,
    config.maxConcurrency,
    async (batch, batchIdx): Promise<BatchResult<TItem, TResult>> => {
      const matched = new Map<TItem, TResult>()
      const missing: TItem[] = []

      onProgress?.(`LLM batch ${batchIdx + 1}/${batches.length} (${batch.length} items)`)

      // Single-item batch → use richer single prompt
      if (batch.length === 1) {
        const item = batch[0]!
        try {
          const result = await callSingle(buildSinglePrompt(item))
          matched.set(item, result)
          consecutiveFatalErrors = 0
        } catch (error: unknown) {
          const msg = errorMessage(error)
          if (isFatalError(msg)) {
            consecutiveFatalErrors++
            if (consecutiveFatalErrors >= FATAL_THRESHOLD) {
              throw new Error(`LLM endpoint is misconfigured: ${msg}. Aborting after ${FATAL_THRESHOLD} consecutive fatal errors.`)
            }
          } else {
            consecutiveFatalErrors = 0
          }
          missing.push(item)
        }
        return { matched, missing }
      }

      // Multi-item batch — single attempt (provider handles per-call retry)
      try {
        const prompt = buildPrompt(batch)
        const response = await callBatch(prompt)
        consecutiveFatalErrors = 0

        // Match results back to items
        for (const item of batch) {
          const match = response.results.find((r) => matchResult(item, r))
          if (match) {
            matched.set(item, match)
          } else {
            missing.push(item)
          }
        }
      } catch (error: unknown) {
        const msg = errorMessage(error)

        if (isFatalError(msg)) {
          consecutiveFatalErrors++
          if (consecutiveFatalErrors >= FATAL_THRESHOLD) {
            throw new Error(`LLM endpoint is misconfigured: ${msg}. Aborting after ${FATAL_THRESHOLD} consecutive fatal errors.`)
          }
          missing.push(...batch)
          return { matched, missing }
        }
        consecutiveFatalErrors = 0

        // Parse failures → split batch in half and retry each half
        if (batch.length > 1) {
          onProgress?.(`batch ${batchIdx + 1} failed, splitting into halves`)
          const mid = Math.ceil(batch.length / 2)
          for (const halfBatch of [batch.slice(0, mid), batch.slice(mid)]) {
            if (halfBatch.length === 0) continue
            try {
              if (halfBatch.length === 1) {
                const singleResult = await callSingle(buildSinglePrompt(halfBatch[0]!))
                matched.set(halfBatch[0]!, singleResult)
              } else {
                const halfPrompt = buildPrompt(halfBatch)
                const halfResponse = await callBatch(halfPrompt)
                for (const item of halfBatch) {
                  const match = halfResponse.results.find((r) => matchResult(item, r))
                  if (match) {
                    matched.set(item, match)
                  } else {
                    missing.push(item)
                  }
                }
              }
            } catch {
              missing.push(...halfBatch)
            }
          }
        } else {
          missing.push(...batch)
        }
      }

      return { matched, missing }
    }
  )

  // Collect results and missing items from all batches
  const allMissing: TItem[] = []
  for (const br of batchResults) {
    for (const [item, result] of br.matched) {
      allResults.set(item, result)
    }
    allMissing.push(...br.missing)
  }

  if (allMissing.length === 0) {
    onProgress?.(`all ${items.length} items processed successfully`)
    return { results: allResults, failures: [] }
  }

  // Re-batch round: retry missing items in smaller groups (up to 2 rounds)
  let retryItems = allMissing
  for (let round = 0; round < 2 && retryItems.length > 0; round++) {
    onProgress?.(`re-batch round ${round + 1}: retrying ${retryItems.length} missing items`)
    const retryBatches = chunk(retryItems, Math.max(1, Math.ceil(config.maxItemsPerBatch / 2)))
    const nextMissing: TItem[] = []

    for (const retryBatch of retryBatches) {
      if (retryBatch.length === 1) {
        try {
          const result = await callSingle(buildSinglePrompt(retryBatch[0]!))
          allResults.set(retryBatch[0]!, result)
        } catch {
          nextMissing.push(retryBatch[0]!)
        }
      } else {
        try {
          const prompt = buildPrompt(retryBatch)
          const response = await callBatch(prompt)
          for (const item of retryBatch) {
            const match = response.results.find((r) => matchResult(item, r))
            if (match) {
              allResults.set(item, match)
            } else {
              nextMissing.push(item)
            }
          }
        } catch {
          nextMissing.push(...retryBatch)
        }
      }
    }
    retryItems = nextMissing
  }

  // Final fallback: individual calls for any remaining items
  if (retryItems.length > 0) {
    onProgress?.(`final fallback: ${retryItems.length} items retrying individually`)
    for (const item of retryItems) {
      try {
        const result = await callSingle(buildSinglePrompt(item))
        allResults.set(item, result)
      } catch {
        // Truly failed — will appear in failures list
      }
    }
  }

  const failures = items.filter((item) => !allResults.has(item))
  onProgress?.(`batch processing complete: ${allResults.size} succeeded, ${failures.length} failed`)
  return { results: allResults, failures }
}
