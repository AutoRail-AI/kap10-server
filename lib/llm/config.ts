/**
 * Centralized LLM configuration — AWS Bedrock only.
 *
 * ALL model names, cost tables, and limits live here.
 * Authentication uses AWS_BEARER_TOKEN_BEDROCK env var.
 *
 * Environment overrides (all optional):
 *   AWS_REGION              — AWS region (default: "us-east-1")
 *   LLM_MODEL_FAST          — Model for simple/cheap tasks
 *   LLM_MODEL_STANDARD      — Default model for most entities
 *   LLM_MODEL_PREMIUM       — Model for high-centrality / complex entities
 *   EMBEDDING_MODEL         — Bedrock embedding model
 */

// ── Models ────────────────────────────────────────────────────────────────────

export const AWS_REGION: string = process.env.AWS_REGION ?? "us-east-1"

/** Tier-based model selection. Override per-tier via env vars. */
export const LLM_MODELS = {
  /** Simple entities (variables, constants) — fastest & cheapest. */
  fast: process.env.LLM_MODEL_FAST ?? "anthropic.claude-haiku-4-5-20251001-v1:0",
  /** Default for most entities — good quality/cost balance. */
  standard: process.env.LLM_MODEL_STANDARD ?? "anthropic.claude-sonnet-4-20250514-v1:0",
  /** High-centrality / complex dependency entities — best quality. */
  premium: process.env.LLM_MODEL_PREMIUM ?? "anthropic.claude-sonnet-4-20250514-v1:0",
} as const

/** Bedrock embedding model. */
export const EMBEDDING_MODEL: string =
  process.env.EMBEDDING_MODEL ?? "amazon.titan-embed-text-v2:0"

// ── Costs ─────────────────────────────────────────────────────────────────────

/** Per-token costs (USD) for billing estimation. Fallback: $1/$3 per 1M. */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "anthropic.claude-haiku-4-5-20251001-v1:0": { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
  "anthropic.claude-sonnet-4-20250514-v1:0": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "amazon.titan-embed-text-v2:0": { input: 0.02 / 1_000_000, output: 0 },
}

export const MODEL_COST_FALLBACK = { input: 1 / 1_000_000, output: 3 / 1_000_000 }

// ── Model Limits ──────────────────────────────────────────────────────────────

/** Per-model context window and max output token limits. */
export const MODEL_LIMITS: Record<string, { contextWindow: number; maxOutput: number }> = {
  "anthropic.claude-haiku-4-5-20251001-v1:0": { contextWindow: 200_000, maxOutput: 8192 },
  "anthropic.claude-sonnet-4-20250514-v1:0": { contextWindow: 200_000, maxOutput: 8192 },
  "amazon.titan-embed-text-v2:0": { contextWindow: 8192, maxOutput: 0 },
}

export const MODEL_LIMITS_FALLBACK = { contextWindow: 200_000, maxOutput: 4096 }

// ── Provider Rate Limits ─────────────────────────────────────────────────────

/**
 * Per-model TPM (tokens per minute) limits.
 * Bedrock quotas are per-model and per-region — defaults are conservative.
 */
export const MODEL_TPM_LIMITS: Record<string, number> = {
  "anthropic.claude-haiku-4-5-20251001-v1:0": 400_000,
  "anthropic.claude-sonnet-4-20250514-v1:0": 200_000,
}

/** Fallback TPM if model not in MODEL_TPM_LIMITS. */
export const MODEL_TPM_FALLBACK = 200_000

/**
 * Get the effective TPM limit for the standard model.
 * Used as the default for the rate limiter when LLM_TPM_LIMIT is not set.
 */
export function getProviderTpmLimit(): number {
  const model = LLM_MODELS.standard
  return MODEL_TPM_LIMITS[model] ?? MODEL_TPM_FALLBACK
}

// ── Concurrency Limits ───────────────────────────────────────────────────────

/**
 * Max parallel justification chunks.
 * Bedrock has generous throughput — default to 5.
 * Override via JUSTIFY_MAX_PARALLEL_CHUNKS env var.
 */
export function getMaxParallelChunks(): number {
  const envOverride = process.env.JUSTIFY_MAX_PARALLEL_CHUNKS
  if (envOverride) return parseInt(envOverride, 10)
  return 5
}
