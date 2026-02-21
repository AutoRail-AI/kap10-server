/**
 * VercelAIProvider — ILLMProvider implementation using Vercel AI SDK.
 * Phase 4: generateObject with Zod schema, streamText, embed.
 *
 * All SDK imports use require() with NO `typeof import(...)` type assertions
 * so webpack never resolves these at build time. The 'ai' and '@ai-sdk/openai'
 * packages are only needed at runtime on workers where they are installed.
 */

import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { OrgContext, TokenUsage } from "@/lib/ports/types"

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

export class VercelAIProvider implements ILLMProvider {
  private getOpenAI(): any {
    const mod = require("@ai-sdk/openai") as any
    return mod.createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async generateObject<T>(params: {
    model: string
    schema: { parse: (v: unknown) => T }
    prompt: string
    context?: OrgContext
    temperature?: number
  }): Promise<{ object: T; usage: TokenUsage }> {
    const ai = require("ai") as any
    const openai = this.getOpenAI()

    const result = await ai.generateObject({
      model: openai(params.model),
      schema: params.schema,
      prompt: params.prompt,
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
    const openai = this.getOpenAI()

    const result = ai.streamText({
      model: openai(params.model),
      prompt: params.prompt,
    })

    for await (const chunk of (await result).textStream) {
      yield chunk
    }
  }

  async embed(params: { model: string; texts: string[] }): Promise<number[][]> {
    const ai = require("ai") as any
    const openai = this.getOpenAI()

    const result = await ai.embedMany({
      model: openai.embedding(params.model),
      values: params.texts,
    })

    return result.embeddings
  }
}
