/**
 * Centralized LLM configuration.
 *
 * ALL model names, provider settings, and cost tables live here.
 * To switch providers or models, edit this file only — no other
 * source files should hardcode model names or API key env vars.
 *
 * Environment overrides (all optional):
 *   LLM_PROVIDER            — Provider: "google" | "openai" | "anthropic" | "ollama"
 *   GEMINI_API_KEY           — Google Gemini API key
 *   OPENAI_API_KEY           — OpenAI key (used for embeddings, or as primary)
 *   ANTHROPIC_API_KEY        — Anthropic key
 *   OLLAMA_BASE_URL          — Ollama endpoint (default: http://localhost:11434/v1)
 *   LLM_BASE_URL             — Generic OpenAI-compatible endpoint (overrides OLLAMA_BASE_URL)
 *   LLM_API_KEY              — API key for remote endpoints (default: "ollama" for local)
 *   LLM_MODEL                — Single model for all tiers (overrides per-tier defaults)
 *   LLM_MODEL_FAST           — Model for simple/cheap tasks (variables, constants)
 *   LLM_MODEL_STANDARD       — Default model for most entities
 *   LLM_MODEL_PREMIUM        — Model for high-centrality / complex entities
 */

// ── Provider ──────────────────────────────────────────────────────────────────

export type LLMProviderType = "google" | "openai" | "anthropic" | "ollama"

/**
 * Which provider SDK to use for text generation.
 * Driven by LLM_PROVIDER env var (default: "google").
 */
export const LLM_PROVIDER: LLMProviderType =
  (process.env.LLM_PROVIDER as LLMProviderType | undefined) ?? "google"

/** Unified base URL for OpenAI-compatible endpoints (Ollama, Lightning AI, vLLM, etc.). */
export const OLLAMA_BASE_URL: string =
  process.env.LLM_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1"

/** API key for OpenAI-compatible endpoints (Ollama ignores it, Lightning AI needs it). */
export const LLM_API_KEY: string =
  process.env.LLM_API_KEY ?? "ollama"

/** Single-model override: when set, all 3 tiers use this model. */
const LLM_MODEL = process.env.LLM_MODEL

/** API key for the active text-generation provider. */
export function getLLMApiKey(): string | undefined {
  switch (LLM_PROVIDER) {
    case "google":
      return process.env.GEMINI_API_KEY
    case "openai":
      return process.env.OPENAI_API_KEY
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY
    case "ollama":
      return LLM_API_KEY
  }
}

// ── Models ────────────────────────────────────────────────────────────────────

/** Default model names per provider when no env override is set. */
const PROVIDER_MODEL_DEFAULTS: Record<LLMProviderType, { fast: string; standard: string; premium: string }> = {
  google: {
    fast: "gemini-2.0-flash-lite",
    standard: "gemini-2.0-flash",
    premium: "gemini-2.0-flash",
  },
  openai: {
    fast: "gpt-4.1-nano",
    standard: "gpt-4.1-mini",
    premium: "gpt-4.1-mini",
  },
  anthropic: {
    fast: "claude-3-haiku-20240307",
    standard: "claude-sonnet-4-20250514",
    premium: "claude-sonnet-4-20250514",
  },
  ollama: {
    fast: LLM_MODEL ?? "qwen3:8b",
    standard: LLM_MODEL ?? "qwen3:8b",
    premium: LLM_MODEL ?? "qwen3-coder",
  },
}

const defaults = PROVIDER_MODEL_DEFAULTS[LLM_PROVIDER]

/** Tier-based model selection. Override per-tier via env vars. */
export const LLM_MODELS = {
  /** Simple entities (variables, constants) — fastest & cheapest. */
  fast: process.env.LLM_MODEL_FAST ?? defaults.fast,
  /** Default for most entities — good quality/cost balance. */
  standard: process.env.LLM_MODEL_STANDARD ?? defaults.standard,
  /** High-centrality / complex dependency entities — best quality. */
  premium: process.env.LLM_MODEL_PREMIUM ?? defaults.premium,
} as const

// ── Costs ─────────────────────────────────────────────────────────────────────

/** Per-token costs (USD) for billing estimation. Fallback: $1/$3 per 1M. */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Gemini 2.0
  "gemini-2.0-flash": { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
  "gemini-2.0-flash-lite": { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 },
  // OpenAI
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "gpt-4o": { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
  "gpt-4.1": { input: 2.0 / 1_000_000, output: 8.0 / 1_000_000 },
  "gpt-4.1-mini": { input: 0.4 / 1_000_000, output: 1.6 / 1_000_000 },
  "gpt-4.1-nano": { input: 0.1 / 1_000_000, output: 0.4 / 1_000_000 },
  // Anthropic
  "claude-3-haiku-20240307": { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  "claude-sonnet-4-20250514": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  // Ollama (local — zero cost)
  "qwen3:8b": { input: 0, output: 0 },
  "qwen3-coder": { input: 0, output: 0 },
  "llama3.1:8b": { input: 0, output: 0 },
  "nomic-embed-text": { input: 0, output: 0 },
  // Lightning AI
  "lightning-ai/gpt-oss-20b": { input: 0, output: 0 },
}

export const MODEL_COST_FALLBACK = { input: 1 / 1_000_000, output: 3 / 1_000_000 }

// ── Model Limits ──────────────────────────────────────────────────────────────

/** Per-model context window and max output token limits. */
export const MODEL_LIMITS: Record<string, { contextWindow: number; maxOutput: number }> = {
  "gemini-2.0-flash": { contextWindow: 1_048_576, maxOutput: 8192 },
  "gemini-2.0-flash-lite": { contextWindow: 1_048_576, maxOutput: 8192 },
  "gpt-4o-mini": { contextWindow: 128_000, maxOutput: 16_384 },
  "gpt-4o": { contextWindow: 128_000, maxOutput: 16_384 },
  "gpt-4.1": { contextWindow: 1_047_576, maxOutput: 32_768 },
  "gpt-4.1-mini": { contextWindow: 1_047_576, maxOutput: 32_768 },
  "gpt-4.1-nano": { contextWindow: 1_047_576, maxOutput: 32_768 },
  "claude-3-haiku-20240307": { contextWindow: 200_000, maxOutput: 4096 },
  "claude-sonnet-4-20250514": { contextWindow: 200_000, maxOutput: 8192 },
  // Ollama models
  "qwen3:8b": { contextWindow: 40_960, maxOutput: 4096 },
  "qwen3-coder": { contextWindow: 262_144, maxOutput: 8192 },
  "llama3.1:8b": { contextWindow: 131_072, maxOutput: 4096 },
  "nomic-embed-text": { contextWindow: 8192, maxOutput: 0 },
  // Lightning AI
  "lightning-ai/gpt-oss-20b": { contextWindow: 32_000, maxOutput: 4096 },
}

export const MODEL_LIMITS_FALLBACK = { contextWindow: 32_000, maxOutput: 4096 }

// ── Provider Rate Limits ─────────────────────────────────────────────────────

/**
 * Per-model TPM (tokens per minute) limits from the provider.
 * Used by the rate limiter to avoid slamming provider limits.
 * Only models with known low limits need entries — the fallback is generous.
 */
export const MODEL_TPM_LIMITS: Record<string, number> = {
  // OpenAI (Tier 1 defaults — adjust per your billing tier)
  "gpt-4o": 30_000,
  "gpt-4o-mini": 200_000,
  "gpt-4.1": 30_000,
  "gpt-4.1-mini": 200_000,
  "gpt-4.1-nano": 200_000,
  "o3": 30_000,
  "o4-mini": 200_000,
  // Gemini — generous limits
  "gemini-2.0-flash": 4_000_000,
  "gemini-2.0-flash-lite": 4_000_000,
  // Anthropic
  "claude-3-haiku-20240307": 400_000,
  "claude-sonnet-4-20250514": 400_000,
}

/** Fallback TPM if model not in MODEL_TPM_LIMITS. */
export const MODEL_TPM_FALLBACK = 200_000

/**
 * Get the effective TPM limit for the current provider's standard model.
 * Used as the default for the rate limiter when LLM_TPM_LIMIT is not set.
 */
export function getProviderTpmLimit(): number {
  const model = LLM_MODELS.standard
  return MODEL_TPM_LIMITS[model] ?? MODEL_TPM_FALLBACK
}

// ── Concurrency Limits ───────────────────────────────────────────────────────

/**
 * Max parallel justification chunks per provider.
 * Controls how many justifyBatch activities run simultaneously in Promise.all().
 *
 * - Ollama: 1 (local inference — one request at a time)
 * - OpenAI: depends on TPM — low-TPM models get fewer parallel chunks
 * - Google/Anthropic: generous limits, high parallelism
 *
 * Override via JUSTIFY_MAX_PARALLEL_CHUNKS env var.
 */
export function getMaxParallelChunks(): number {
  const envOverride = process.env.JUSTIFY_MAX_PARALLEL_CHUNKS
  if (envOverride) return parseInt(envOverride, 10)

  switch (LLM_PROVIDER) {
    case "ollama":
      return 1 // Local inference — sequential only
    case "openai": {
      // Scale based on TPM limit of the standard model
      const tpm = MODEL_TPM_LIMITS[LLM_MODELS.standard] ?? MODEL_TPM_FALLBACK
      if (tpm <= 30_000) return 2
      if (tpm <= 200_000) return 5
      return 10
    }
    case "anthropic":
      return 5
    case "google":
      return 10 // Gemini has very generous rate limits
    default:
      return 3
  }
}
