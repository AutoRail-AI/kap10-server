/**
 * BedrockProvider — ILLMProvider implementation using AWS Bedrock via Vercel AI SDK.
 *
 * Uses @ai-sdk/amazon-bedrock for text generation.
 * Authentication via AWS_BEARER_TOKEN_BEDROCK env var.
 *
 * Includes:
 *  - Proactive sliding-window rate limiting (RPM/TPM)
 *  - Exponential backoff with jitter for throttling errors
 *  - Token budget pre-checks
 */

import { AWS_REGION } from "@/lib/llm/config"
import { RateLimiter } from "@/lib/llm/rate-limiter"
import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { OrgContext, TokenUsage } from "@/lib/ports/types"

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Retry configuration ──────────────────────────────────────────────────────

const RETRY_MAX_ATTEMPTS = parseInt(process.env.LLM_RETRY_MAX_ATTEMPTS ?? "5", 10)
const RETRY_BASE_DELAY_MS = parseInt(process.env.LLM_RETRY_BASE_DELAY_MS ?? "1000", 10)

export class BedrockProvider implements ILLMProvider {
  private readonly rateLimiter = new RateLimiter()

  /**
   * Return a Bedrock provider instance.
   * Auth: the SDK auto-reads AWS_BEARER_TOKEN_BEDROCK from the environment
   * and sends it as `Authorization: Bearer <token>`. No explicit credential
   * config needed — just set the env var.
   */
  private getBedrock(): any {
    const mod = require("@ai-sdk/amazon-bedrock") as any
    return mod.createAmazonBedrock({
      region: AWS_REGION,
    })
  }

  /** Detect if an error is a rate limit / throttling error. */
  private isRateLimitError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    const lower = message.toLowerCase()
    return (
      lower.includes("429") ||
      lower.includes("throttl") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests") ||
      lower.includes("resource exhausted")
    )
  }

  /** Try to extract retry-after seconds from error chain. */
  private extractRetryAfterMs(error: unknown): number | null {
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
   * Only retries on rate-limit / throttling errors. Other errors propagate immediately.
   */
  private async retryWithBackoff<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        await this.rateLimiter.waitForSlot()
        return await fn()
      } catch (error: unknown) {
        lastError = error

        if (!this.isRateLimitError(error) || attempt === RETRY_MAX_ATTEMPTS - 1) {
          throw error
        }

        const retryAfterMs = this.extractRetryAfterMs(error)
        const exponentialMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        const jitterMs = Math.random() * RETRY_BASE_DELAY_MS
        const delayMs = retryAfterMs ?? (exponentialMs + jitterMs)

        console.warn(
          `[BedrockProvider] ${label} throttled (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}), retrying in ${Math.round(delayMs)}ms`
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
      const bedrock = this.getBedrock()

      const result = await ai.generateObject({
        model: bedrock(params.model),
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
    const bedrock = this.getBedrock()

    // Wrap the initial call with retry (throttling occurs on request, not during streaming)
    const result = await this.retryWithBackoff(
      () => ai.streamText({ model: bedrock(params.model), prompt: params.prompt }),
      `streamText(${params.model})`
    ) as { textStream: AsyncIterable<string> }

    for await (const chunk of result.textStream) {
      yield chunk
    }
  }

  async embed(_params: { model: string; texts: string[] }): Promise<number[][]> {
    throw new Error(
      "BedrockProvider.embed() is not used. Embeddings are handled by LlamaIndexVectorSearch (local CPU model)."
    )
  }
}
