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

/** Ollama API base URL (OpenAI-compatible endpoint). */
export const OLLAMA_BASE_URL: string =
  process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1"

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
      // Ollama doesn't need an API key, but the SDK requires a non-empty value
      return "ollama"
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
    fast: "gpt-4o-mini",
    standard: "gpt-4o-mini",
    premium: "gpt-4o",
  },
  anthropic: {
    fast: "claude-3-haiku-20240307",
    standard: "claude-sonnet-4-20250514",
    premium: "claude-sonnet-4-20250514",
  },
  ollama: {
    fast: "qwen3:8b",
    standard: "qwen3:8b",
    premium: "qwen3-coder",
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
  // Anthropic
  "claude-3-haiku-20240307": { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  "claude-sonnet-4-20250514": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  // Ollama (local — zero cost)
  "qwen3:8b": { input: 0, output: 0 },
  "qwen3-coder": { input: 0, output: 0 },
  "llama3.1:8b": { input: 0, output: 0 },
  "nomic-embed-text": { input: 0, output: 0 },
}

export const MODEL_COST_FALLBACK = { input: 1 / 1_000_000, output: 3 / 1_000_000 }

// ── Model Limits ──────────────────────────────────────────────────────────────

/** Per-model context window and max output token limits. */
export const MODEL_LIMITS: Record<string, { contextWindow: number; maxOutput: number }> = {
  "gemini-2.0-flash": { contextWindow: 1_048_576, maxOutput: 8192 },
  "gemini-2.0-flash-lite": { contextWindow: 1_048_576, maxOutput: 8192 },
  "gpt-4o-mini": { contextWindow: 128_000, maxOutput: 16_384 },
  "gpt-4o": { contextWindow: 128_000, maxOutput: 16_384 },
  "claude-3-haiku-20240307": { contextWindow: 200_000, maxOutput: 4096 },
  "claude-sonnet-4-20250514": { contextWindow: 200_000, maxOutput: 8192 },
  // Ollama models
  "qwen3:8b": { contextWindow: 40_960, maxOutput: 4096 },
  "qwen3-coder": { contextWindow: 262_144, maxOutput: 8192 },
  "llama3.1:8b": { contextWindow: 131_072, maxOutput: 4096 },
  "nomic-embed-text": { contextWindow: 8192, maxOutput: 0 },
}

export const MODEL_LIMITS_FALLBACK = { contextWindow: 32_000, maxOutput: 4096 }
