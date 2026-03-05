/**
 * Centralized LLM configuration — AWS Bedrock only.
 *
 * Task-based model groups replace the old tier system.
 * Default models: GPT-OSS (20B/120B) + Qwen3 Coder 30B on Bedrock.
 *
 * Environment overrides (all optional):
 *   AWS_REGION                       — AWS region (default: "us-east-1")
 *   LLM_MODEL_CODE_REASONING         — Bulk code classification (Qwen3 Coder 30B)
 *   LLM_MODEL_CODE_REASONING_COMPLEX — Safety/high-centrality entities (GPT-OSS 120B)
 *   LLM_MODEL_CODE_REASONING_SIMPLE  — Variables, constants (GPT-OSS 20B)
 *   LLM_MODEL_ANALYSIS               — Ontology, anti-patterns, rules (GPT-OSS 120B)
 *   LLM_MODEL_WRITING                — ADR generation, drift docs (GPT-OSS 120B)
 *   LLM_MODEL_CLASSIFICATION         — Drift detection, pattern synthesis (GPT-OSS 20B)
 */

// ── Models ────────────────────────────────────────────────────────────────────

export const AWS_REGION: string = process.env.AWS_REGION ?? "us-east-1"

/** Task-based model groups. Each group maps to a specific workload type. */
export type ModelGroup =
  | "code_reasoning"
  | "code_reasoning_complex"
  | "code_reasoning_simple"
  | "analysis"
  | "writing"
  | "classification"

/** Default Bedrock model ID for each group. */
const MODEL_GROUP_DEFAULTS: Record<ModelGroup, string> = {
  code_reasoning: "qwen.qwen3-coder-30b-a3b-v1:0",
  code_reasoning_complex: "openai.gpt-oss-120b-1:0",
  code_reasoning_simple: "openai.gpt-oss-20b-1:0",
  analysis: "openai.gpt-oss-120b-1:0",
  writing: "openai.gpt-oss-120b-1:0",
  classification: "openai.gpt-oss-20b-1:0",
}

/** Env var name for each group. */
const MODEL_GROUP_ENV_KEYS: Record<ModelGroup, string> = {
  code_reasoning: "LLM_MODEL_CODE_REASONING",
  code_reasoning_complex: "LLM_MODEL_CODE_REASONING_COMPLEX",
  code_reasoning_simple: "LLM_MODEL_CODE_REASONING_SIMPLE",
  analysis: "LLM_MODEL_ANALYSIS",
  writing: "LLM_MODEL_WRITING",
  classification: "LLM_MODEL_CLASSIFICATION",
}

/**
 * Get the Bedrock model ID for a given task group.
 * Reads the corresponding env var, falling back to the default.
 */
export function getModelForGroup(group: ModelGroup): string {
  const envKey = MODEL_GROUP_ENV_KEYS[group]
  return process.env[envKey] ?? MODEL_GROUP_DEFAULTS[group]
}

// ── Embedding & Reranking Models ──────────────────────────────────────────────

/** Vertex AI model for embedding (Gemini Embedding 001, 768 dims via outputDimensionality). */
export const EMBEDDING_MODEL_ID: string =
  process.env.EMBEDDING_MODEL_ID ?? "gemini-embedding-001"

/** Embedding output dimensions. Gemini Embedding 001 supports up to 3072; we use 768 for pgvector efficiency. */
export const EMBEDDING_DIMENSIONS: number =
  process.env.EMBEDDING_DIMENSIONS ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10) : 768

/** Google Vertex AI API key for embedding (express mode — no service account needed). */
export const GOOGLE_VERTEX_API_KEY: string | undefined =
  process.env.GOOGLE_VERTEX_API_KEY

/** Bedrock model ID for cross-encoder reranking (Cohere Rerank 3.5). */
export const RERANKER_MODEL_ID: string =
  process.env.RERANKER_MODEL_ID ?? "cohere.rerank-v3-5:0"

// ── Costs ─────────────────────────────────────────────────────────────────────

/** Per-token costs (USD) for billing estimation. Fallback: $0.15/$0.60 per 1M. */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "openai.gpt-oss-20b-1:0": { input: 0.07 / 1_000_000, output: 0.30 / 1_000_000 },
  "openai.gpt-oss-120b-1:0": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  "qwen.qwen3-coder-30b-a3b-v1:0": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  "qwen.qwen3-32b-v1:0": { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
}

export const MODEL_COST_FALLBACK = { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 }

// ── Model Limits ──────────────────────────────────────────────────────────────

/** Per-model context window and max output token limits. */
export const MODEL_LIMITS: Record<string, { contextWindow: number; maxOutput: number }> = {
  "openai.gpt-oss-20b-1:0": { contextWindow: 128_000, maxOutput: 8192 },
  "openai.gpt-oss-120b-1:0": { contextWindow: 128_000, maxOutput: 8192 },
  "qwen.qwen3-coder-30b-a3b-v1:0": { contextWindow: 128_000, maxOutput: 8192 },
  "qwen.qwen3-32b-v1:0": { contextWindow: 128_000, maxOutput: 8192 },
}

export const MODEL_LIMITS_FALLBACK = { contextWindow: 128_000, maxOutput: 4096 }

// ── Provider Rate Limits ─────────────────────────────────────────────────────

/**
 * Per-model TPM (tokens per minute) limits.
 * Bedrock quotas are per-model and per-region — defaults are conservative.
 */
export const MODEL_TPM_LIMITS: Record<string, number> = {
  "openai.gpt-oss-20b-1:0": 100_000_000,
  "openai.gpt-oss-120b-1:0": 100_000_000,
  "qwen.qwen3-coder-30b-a3b-v1:0": 100_000_000,
  "qwen.qwen3-32b-v1:0": 100_000_000,
}

/** Fallback TPM if model not in MODEL_TPM_LIMITS. */
export const MODEL_TPM_FALLBACK = 200_000

/**
 * Get the effective TPM limit for the highest-volume model group (code_reasoning).
 * Used as the default for the rate limiter when LLM_TPM_LIMIT is not set.
 */
export function getProviderTpmLimit(): number {
  const model = getModelForGroup("code_reasoning")
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
