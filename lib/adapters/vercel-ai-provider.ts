/**
 * VercelAIProvider — ILLMProvider implementation using Vercel AI SDK.
 * Phase 4: generateObject with Zod schema, streamText, embed.
 *
 * Provider selection is driven by `lib/llm/config.ts`.
 * All SDK imports use require() so webpack never resolves them at build time.
 *
 * Includes:
 *  - Proactive sliding-window rate limiting (RPM/TPM)
 *  - Exponential backoff with jitter for 429 / rate-limit errors
 */

import { getLLMApiKey, LLM_PROVIDER } from "@/lib/llm/config"
import { RateLimiter } from "@/lib/llm/rate-limiter"
import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { OrgContext, TokenUsage } from "@/lib/ports/types"

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Dynamic require that hides the module path from webpack static analysis. */
function dynamicRequire(mod: string): any {
   
  return eval("require")(mod)
}

// ── Retry configuration ──────────────────────────────────────────────────────

const RETRY_MAX_ATTEMPTS = parseInt(process.env.LLM_RETRY_MAX_ATTEMPTS ?? "5", 10)
const RETRY_BASE_DELAY_MS = parseInt(process.env.LLM_RETRY_BASE_DELAY_MS ?? "1000", 10)

export class VercelAIProvider implements ILLMProvider {
  private readonly rateLimiter = new RateLimiter()

  /** Return a Vercel AI SDK provider instance for the configured LLM_PROVIDER. */
  private getTextProvider(): any {
    const apiKey = getLLMApiKey()
    switch (LLM_PROVIDER) {
      case "google": {
        const mod = require("@ai-sdk/google") as any
        return mod.createGoogleGenerativeAI({ apiKey })
      }
      case "openai": {
        const mod = require("@ai-sdk/openai") as any
        return mod.createOpenAI({ apiKey })
      }
      case "anthropic": {
        // Dynamic require — @ai-sdk/anthropic is optional, only install if needed
        const mod = dynamicRequire("@ai-sdk/anthropic") as any
        return mod.createAnthropic({ apiKey })
      }
      case "ollama":
        // Should not be reached — OllamaProvider handles this
        throw new Error("VercelAIProvider should not be used with ollama. Use OllamaProvider instead.")
    }
  }

  /** OpenAI provider for embeddings (separate from text-generation provider). */
  private getOpenAI(): any {
    const mod = require("@ai-sdk/openai") as any
    return mod.createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  /** Detect if an error is a rate limit (429) error. */
  private isRateLimitError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    const lower = message.toLowerCase()
    return (
      lower.includes("429") ||
      lower.includes("resource exhausted") ||
      lower.includes("rate limit") ||
      lower.includes("quota exceeded") ||
      lower.includes("too many requests")
    )
  }

  /** Try to extract retry-after seconds from error chain. */
  private extractRetryAfterMs(error: unknown): number | null {
    // Vercel AI SDK wraps the HTTP response in error.cause or error.data
    const err = error as Record<string, any>
    const retryAfter =
      err?.headers?.["retry-after"] ??
      err?.cause?.headers?.["retry-after"] ??
      err?.data?.headers?.["retry-after"] ??
      err?.responseHeaders?.["retry-after"]

    if (retryAfter != null) {
      const seconds = Number(retryAfter)
      if (!isNaN(seconds) && seconds > 0) {
        return seconds * 1000
      }
    }
    return null
  }

  /**
   * Wrap an async function with exponential backoff + jitter.
   * Only retries on rate-limit errors (429). Other errors propagate immediately.
   */
  private async retryWithBackoff<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        // Wait for rate limiter slot before each attempt
        await this.rateLimiter.waitForSlot()
        return await fn()
      } catch (error: unknown) {
        lastError = error

        if (!this.isRateLimitError(error) || attempt === RETRY_MAX_ATTEMPTS - 1) {
          throw error
        }

        // Calculate delay: retry-after header > exponential backoff + jitter
        const retryAfterMs = this.extractRetryAfterMs(error)
        const exponentialMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        const jitterMs = Math.random() * RETRY_BASE_DELAY_MS
        const delayMs = retryAfterMs ?? (exponentialMs + jitterMs)

        console.warn(
          `[VercelAIProvider] ${label} rate-limited (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}), retrying in ${Math.round(delayMs)}ms`
        )
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }

    throw lastError
  }

  /** Rough token estimate: ~4 chars per token for English text. */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  async generateObject<T>(params: {
    model: string
    schema: { parse: (v: unknown) => T }
    prompt: string
    system?: string
    context?: OrgContext
    temperature?: number
  }): Promise<{ object: T; usage: TokenUsage }> {
    // Pre-check: wait until estimated tokens fit within TPM budget
    const estimatedTokens = this.estimateTokens(params.prompt + (params.system ?? ""))
    await this.rateLimiter.waitForTokenBudget(estimatedTokens)

    return this.retryWithBackoff(async () => {
      const ai = require("ai") as any
      const provider = this.getTextProvider()

      const result = await ai.generateObject({
        model: provider(params.model),
        schema: params.schema,
        prompt: params.prompt,
        ...(params.system ? { system: params.system } : {}),
        temperature: params.temperature ?? 0.1,
      })

      const usage: TokenUsage = {
        inputTokens: result.usage?.promptTokens ?? 0,
        outputTokens: result.usage?.completionTokens ?? 0,
      }

      // Record actual token usage for TPM tracking
      await this.rateLimiter.recordUsage(usage.inputTokens + usage.outputTokens)

      const parsed = params.schema.parse(result.object)
      return { object: parsed, usage }
    }, `generateObject(${params.model})`)
  }

  async *streamText(params: {
    model: string
    prompt: string
    context?: OrgContext
  }): AsyncIterable<string> {
    // Wait for rate limiter before initiating the stream
    await this.rateLimiter.waitForSlot()

    const ai = require("ai") as any
    const provider = this.getTextProvider()

    // Wrap the initial call with retry (429 occurs on request, not during streaming)
    const result = await this.retryWithBackoff(
      () => ai.streamText({ model: provider(params.model), prompt: params.prompt }),
      `streamText(${params.model})`
    ) as { textStream: AsyncIterable<string> }

    for await (const chunk of result.textStream) {
      yield chunk
    }
  }

  async embed(params: { model: string; texts: string[] }): Promise<number[][]> {
    return this.retryWithBackoff(async () => {
      const ai = require("ai") as any
      const openai = this.getOpenAI()

      const result = await ai.embedMany({
        model: openai.embedding(params.model),
        values: params.texts,
      })

      return result.embeddings
    }, `embed(${params.model})`)
  }
}
