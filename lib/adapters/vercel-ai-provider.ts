/**
 * VercelAIProvider — ILLMProvider implementation using Vercel AI SDK.
 * Phase 4: generateObject with Zod schema, streamText, embed.
 *
 * Provider selection is driven by `lib/llm/config.ts`.
 * All SDK imports use require() so webpack never resolves them at build time.
 */

import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { OrgContext, TokenUsage } from "@/lib/ports/types"
import { LLM_PROVIDER, getLLMApiKey } from "@/lib/llm/config"

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

/** Dynamic require that hides the module path from webpack static analysis. */
function dynamicRequire(mod: string): any {
  // eslint-disable-next-line no-eval
  return eval("require")(mod)
}

export class VercelAIProvider implements ILLMProvider {
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
    }
  }

  /** OpenAI provider for embeddings (separate from text-generation provider). */
  private getOpenAI(): any {
    const mod = require("@ai-sdk/openai") as any
    return mod.createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
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
    const provider = this.getTextProvider()

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
    const provider = this.getTextProvider()

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
    const openai = this.getOpenAI()

    const result = await ai.embedMany({
      model: openai.embedding(params.model),
      values: params.texts,
    })

    return result.embeddings
  }
}
