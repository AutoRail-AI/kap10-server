/**
 * OllamaProvider — ILLMProvider implementation using any
 * OpenAI-compatible API via @ai-sdk/openai.
 *
 * Works with local Ollama, Lightning AI, vLLM, or any OpenAI-compatible endpoint.
 * When pointed at a remote endpoint, rate limiting and retry logic are enabled.
 *
 * Environment:
 *   LLM_BASE_URL  — Endpoint URL (overrides OLLAMA_BASE_URL, default: http://localhost:11434/v1)
 *   LLM_API_KEY   — API key for remote endpoints (default: "ollama" for local)
 *   LLM_MODEL     — Single model for all tiers (optional)
 */

import { LLM_API_KEY, OLLAMA_BASE_URL } from "@/lib/llm/config"
import { RateLimiter } from "@/lib/llm/rate-limiter"
import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { OrgContext, TokenUsage } from "@/lib/ports/types"

/* eslint-disable @typescript-eslint/no-explicit-any */

const RETRY_MAX_ATTEMPTS = parseInt(process.env.LLM_RETRY_MAX_ATTEMPTS ?? "5", 10)
const RETRY_BASE_DELAY_MS = parseInt(process.env.LLM_RETRY_BASE_DELAY_MS ?? "1000", 10)

export class OllamaProvider implements ILLMProvider {
  private readonly rateLimiter = new RateLimiter()
  private readonly isRemote: boolean

  constructor() {
    this.isRemote = !OLLAMA_BASE_URL.includes("localhost") && !OLLAMA_BASE_URL.includes("127.0.0.1")
  }

  /** Create an OpenAI-compatible provider pointed at the configured endpoint. */
  private getProvider(): any {
    const mod = require("@ai-sdk/openai") as any
    return mod.createOpenAI({
      baseURL: OLLAMA_BASE_URL,
      apiKey: LLM_API_KEY,
    })
  }

  /** Retry with exponential backoff + jitter for remote endpoints. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isRemote) return fn()

    let lastError: unknown
    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        await this.rateLimiter.waitForSlot()
        return await fn()
      } catch (err: unknown) {
        lastError = err
        const status = (err as any)?.status ?? (err as any)?.statusCode
        if (status === 429 || status === 503 || status === 502) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }
    throw lastError
  }

  async generateObject<T>(params: {
    model: string
    schema: { parse: (v: unknown) => T }
    prompt: string
    system?: string
    context?: OrgContext
    temperature?: number
  }): Promise<{ object: T; usage: TokenUsage }> {
    const ai = require("ai") as any
    const provider = this.getProvider()

    const result: any = await this.withRetry(() =>
      ai.generateObject({
        model: provider(params.model),
        schema: params.schema,
        prompt: params.prompt,
        ...(params.system ? { system: params.system } : {}),
        temperature: params.temperature ?? 0.1,
      }),
    )

    const parsed = params.schema.parse(result.object)
    const usage: TokenUsage = {
      inputTokens: result.usage?.promptTokens ?? 0,
      outputTokens: result.usage?.completionTokens ?? 0,
    }

    if (this.isRemote) {
      await this.rateLimiter.recordUsage(usage.inputTokens + usage.outputTokens)
    }

    return { object: parsed, usage }
  }

  async *streamText(params: {
    model: string
    prompt: string
    context?: OrgContext
  }): AsyncIterable<string> {
    const ai = require("ai") as any
    const provider = this.getProvider()

    if (this.isRemote) {
      await this.rateLimiter.waitForSlot()
    }

    const result = ai.streamText({
      model: provider(params.model),
      prompt: params.prompt,
    })

    for await (const chunk of (await result).textStream) {
      yield chunk
    }
  }

  async embed(params: { model: string; texts: string[] }): Promise<number[][]> {
    const ai = require("ai") as any
    const provider = this.getProvider()

    const result: any = await this.withRetry(() =>
      ai.embedMany({
        model: provider.embedding(params.model),
        values: params.texts,
      }),
    )

    return result.embeddings
  }
}
