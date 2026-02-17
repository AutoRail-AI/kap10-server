/**
 * Stub ILLMProvider (Phase 0). Phase 4+ will implement with Vercel AI SDK.
 */

import type { ILLMProvider } from "@/lib/ports/llm-provider"
import { NotImplementedError } from "./errors"

export class VercelAIProvider implements ILLMProvider {
  async generateObject<T>(): Promise<{ object: T; usage: { inputTokens: number; outputTokens: number } }> {
    throw new NotImplementedError("ILLMProvider.generateObject not implemented in Phase 0")
  }

  async *streamText(): AsyncIterable<string> {
    throw new NotImplementedError("ILLMProvider.streamText not implemented in Phase 0")
  }

  async embed(): Promise<number[][]> {
    throw new NotImplementedError("ILLMProvider.embed not implemented in Phase 0")
  }
}
