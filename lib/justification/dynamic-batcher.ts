/**
 * Phase 4: Dynamic Batcher — packs entities into token-budgeted batches
 * for efficient LLM processing. Reduces LLM calls by 80-90%.
 *
 * Uses greedy bin-packing with dual constraints (input tokens + output tokens)
 * to prevent truncated LLM responses.
 */

import type { EntityDoc, DomainOntologyDoc, JustificationDoc } from "@/lib/ports/types"
import type { GraphContext } from "./schemas"

/** A single entity prepared for batching with its context */
export interface BatchableEntity {
  entity: EntityDoc
  graphContext: GraphContext
  parentJustification?: JustificationDoc
  estimatedTokens: number
}

/** A batch of entities ready for a single LLM call */
export interface EntityBatch {
  entities: BatchableEntity[]
  totalEstimatedTokens: number
}

/** Configuration for the dynamic batcher */
export interface BatcherConfig {
  /** Maximum input tokens per batch (default: 70% of context window) */
  maxInputTokens: number
  /** Maximum output tokens for the LLM response (default: 8192) */
  maxOutputTokens: number
  /** Maximum entities per batch (default: 15) */
  maxEntitiesPerBatch: number
  /** Estimated tokens for system prompt + instructions (default: 500) */
  systemPromptTokens: number
  /** Reserved tokens for output per entity (default: 200) */
  outputTokensPerEntity: number
  /** Safety margin multiplier to avoid hitting limits (default: 0.85) */
  safetyMargin: number
}

const DEFAULT_CONFIG: BatcherConfig = {
  maxInputTokens: 7000,
  maxOutputTokens: 8192,
  maxEntitiesPerBatch: 15,
  systemPromptTokens: 500,
  outputTokensPerEntity: 200,
  safetyMargin: 0.85,
}

/**
 * Estimate token count for a string.
 * Uses ~3.5 chars/token for code (conservative estimate).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

/**
 * Estimate total token usage for an entity in batch mode.
 * Includes header, metadata, and truncated code body.
 */
export function estimateEntityTokens(entity: EntityDoc, graphContext: GraphContext): number {
  let tokens = 25 // header overhead

  // Name + kind + path
  tokens += estimateTokens(`${entity.name} ${entity.kind} ${entity.file_path}`)

  // Signature
  if (entity.signature) {
    tokens += estimateTokens(entity.signature as string)
  }

  // Code body (truncated to 10 lines for batch)
  const body = entity.body as string | undefined
  if (body) {
    const truncated = body.split("\n").slice(0, 10).join("\n")
    tokens += estimateTokens(truncated)
  }

  // Neighbor summary (compact)
  if (graphContext.neighbors.length > 0) {
    const neighborText = graphContext.neighbors
      .slice(0, 5)
      .map((n) => `${n.name} ${n.kind}`)
      .join(", ")
    tokens += estimateTokens(neighborText)
  }

  return tokens
}

/**
 * Get a BatcherConfig tuned for a specific model's limits.
 * Uses MODEL_LIMITS from config to derive safe input/output budgets.
 */
export function getBatcherConfigForModel(modelName: string): BatcherConfig {
  const { MODEL_LIMITS, MODEL_LIMITS_FALLBACK } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")
  const limits = MODEL_LIMITS[modelName] ?? MODEL_LIMITS_FALLBACK
  const safetyMargin = 0.85

  return {
    maxInputTokens: Math.floor(limits.contextWindow * 0.7),
    maxOutputTokens: limits.maxOutput,
    maxEntitiesPerBatch: 15,
    systemPromptTokens: 500,
    outputTokensPerEntity: 200,
    safetyMargin,
  }
}

/**
 * Create token-budgeted batches from a list of entities.
 *
 * Uses greedy packing with dual constraints:
 * 1. Input token budget — total prompt tokens must not exceed model context window
 * 2. Output token budget — total expected output must not exceed model max output
 *
 * Oversized entities (exceeding budget alone) go solo.
 */
export function createBatches(
  entities: Array<{ entity: EntityDoc; graphContext: GraphContext; parentJustification?: JustificationDoc }>,
  config: Partial<BatcherConfig> = {}
): EntityBatch[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const batches: EntityBatch[] = []

  // Estimate tokens for each entity
  const batchableEntities: BatchableEntity[] = entities.map(({ entity, graphContext, parentJustification }) => ({
    entity,
    graphContext,
    parentJustification,
    estimatedTokens: estimateEntityTokens(entity, graphContext),
  }))

  let currentBatch: BatchableEntity[] = []
  let currentTokens = cfg.systemPromptTokens

  for (const be of batchableEntities) {
    const entityBudget = be.estimatedTokens + cfg.outputTokensPerEntity

    // If this single entity exceeds the budget, it goes solo
    if (cfg.systemPromptTokens + entityBudget > cfg.maxInputTokens * cfg.safetyMargin) {
      // Flush current batch first
      if (currentBatch.length > 0) {
        batches.push({ entities: currentBatch, totalEstimatedTokens: currentTokens })
        currentBatch = []
        currentTokens = cfg.systemPromptTokens
      }
      batches.push({ entities: [be], totalEstimatedTokens: cfg.systemPromptTokens + entityBudget })
      continue
    }

    // Dual constraint check: input tokens AND output tokens
    const wouldExceedInput = currentTokens + entityBudget > cfg.maxInputTokens * cfg.safetyMargin
    const wouldExceedOutput = (currentBatch.length + 1) * cfg.outputTokensPerEntity > cfg.maxOutputTokens * cfg.safetyMargin
    const wouldExceedEntities = currentBatch.length >= cfg.maxEntitiesPerBatch

    if (wouldExceedInput || wouldExceedOutput || wouldExceedEntities) {
      // Flush current batch
      if (currentBatch.length > 0) {
        batches.push({ entities: currentBatch, totalEstimatedTokens: currentTokens })
      }
      currentBatch = []
      currentTokens = cfg.systemPromptTokens
    }

    currentBatch.push(be)
    currentTokens += entityBudget
  }

  // Flush remaining
  if (currentBatch.length > 0) {
    batches.push({ entities: currentBatch, totalEstimatedTokens: currentTokens })
  }

  return batches
}
