/**
 * Centralized LLM configuration.
 *
 * ALL model names, provider settings, and cost tables live here.
 * To switch providers or models, edit this file only — no other
 * source files should hardcode model names or API key env vars.
 *
 * Environment overrides (all optional):
 *   GEMINI_API_KEY          — Google Gemini API key (primary provider)
 *   OPENAI_API_KEY          — OpenAI key (used for embeddings only)
 *   LLM_MODEL_FAST          — Model for simple/cheap tasks (variables, constants)
 *   LLM_MODEL_STANDARD      — Default model for most entities
 *   LLM_MODEL_PREMIUM       — Model for high-centrality / complex entities
 */

// ── Provider ──────────────────────────────────────────────────────────────────

export type LLMProviderType = "google" | "openai" | "anthropic"

/**
 * Which provider SDK to use for text generation.
 * Change this + the API key getter to swap providers.
 */
export const LLM_PROVIDER: LLMProviderType = "google"

/** API key for the active text-generation provider. */
export function getLLMApiKey(): string | undefined {
  switch (LLM_PROVIDER) {
    case "google":
      return process.env.GEMINI_API_KEY
    case "openai":
      return process.env.OPENAI_API_KEY
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY
  }
}

// ── Models ────────────────────────────────────────────────────────────────────

/** Tier-based model selection. Override per-tier via env vars. */
export const LLM_MODELS = {
  /** Simple entities (variables, constants) — fastest & cheapest. */
  fast: process.env.LLM_MODEL_FAST ?? "gemini-2.0-flash-lite",
  /** Default for most entities — good quality/cost balance. */
  standard: process.env.LLM_MODEL_STANDARD ?? "gemini-2.0-flash",
  /** High-centrality / complex dependency entities — best quality. */
  premium: process.env.LLM_MODEL_PREMIUM ?? "gemini-2.0-flash",
} as const

// ── Costs ─────────────────────────────────────────────────────────────────────

/** Per-token costs (USD) for billing estimation. Fallback: $1/$3 per 1M. */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Gemini 2.0
  "gemini-2.0-flash": { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
  "gemini-2.0-flash-lite": { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 },
  // OpenAI (kept for historical cost lookups on older justifications)
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "gpt-4o": { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
  // Anthropic
  "claude-3-haiku-20240307": { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  "claude-sonnet-4-20250514": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
}

export const MODEL_COST_FALLBACK = { input: 1 / 1_000_000, output: 3 / 1_000_000 }
