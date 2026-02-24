/**
 * OllamaProvider — ILLMProvider implementation using Ollama's
 * OpenAI-compatible API via @ai-sdk/openai.
 *
 * Ollama runs locally with unlimited throughput, so no rate limiter is needed.
 *
 * Environment:
 *   OLLAMA_BASE_URL — Ollama endpoint (default: http://localhost:11434/v1)
 */

import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { OrgContext, TokenUsage } from "@/lib/ports/types"
import { OLLAMA_BASE_URL } from "@/lib/llm/config"

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

export class OllamaProvider implements ILLMProvider {
  /** Create an OpenAI-compatible provider pointed at Ollama. */
  private getProvider(): any {
    const mod = require("@ai-sdk/openai") as any
    return mod.createOpenAI({
      baseURL: OLLAMA_BASE_URL,
      apiKey: "ollama", // Required by SDK but ignored by Ollama
    })
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

    const result = await ai.generateObject({
      model: provider(params.model),
      schema: params.schema,
      prompt: params.prompt,
      ...(params.system ? { system: params.system } : {}),
      temperature: params.temperature ?? 0.1,
    })

    const parsed = params.schema.parse(result.object)
    return {
      object: parsed,
      usage: {
        inputTokens: result.usage?.promptTokens ?? 0,
        outputTokens: result.usage?.completionTokens ?? 0,
      },
    }
  }

  async *streamText(params: {
    model: string
    prompt: string
    context?: OrgContext
  }): AsyncIterable<string> {
    const ai = require("ai") as any
    const provider = this.getProvider()

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

    const result = await ai.embedMany({
      model: provider.embedding(params.model),
      values: params.texts,
    })

    return result.embeddings
  }
}
