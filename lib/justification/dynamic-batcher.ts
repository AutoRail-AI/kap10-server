/**
 * Phase 4: Dynamic Batcher — packs entities into token-budgeted batches
 * for efficient LLM processing. Reduces LLM calls by 80-90%.
 *
 * Uses greedy bin-packing: estimates token usage per entity, then fills
 * batches until the budget is exceeded.
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
  /** Maximum entities per batch (default: 15) */
  maxEntitiesPerBatch: number
  /** Estimated tokens for system prompt + instructions (default: 500) */
  systemPromptTokens: number
  /** Reserved tokens for output per entity (default: 150) */
  outputTokensPerEntity: number
}

const DEFAULT_CONFIG: BatcherConfig = {
  maxInputTokens: 7000, // ~10K context * 0.7
  maxEntitiesPerBatch: 15,
  systemPromptTokens: 500,
  outputTokensPerEntity: 150,
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
 * Create token-budgeted batches from a list of entities.
 *
 * Uses greedy packing: adds entities to the current batch until the
 * token budget would be exceeded, then starts a new batch.
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
    if (cfg.systemPromptTokens + entityBudget > cfg.maxInputTokens) {
      // Flush current batch first
      if (currentBatch.length > 0) {
        batches.push({ entities: currentBatch, totalEstimatedTokens: currentTokens })
        currentBatch = []
        currentTokens = cfg.systemPromptTokens
      }
      batches.push({ entities: [be], totalEstimatedTokens: cfg.systemPromptTokens + entityBudget })
      continue
    }

    // Check if adding this entity would exceed the budget or max entities
    if (
      currentTokens + entityBudget > cfg.maxInputTokens ||
      currentBatch.length >= cfg.maxEntitiesPerBatch
    ) {
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
