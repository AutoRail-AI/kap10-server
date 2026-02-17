import type { OrgContext, TokenUsage } from "./types"

export interface ILLMProvider {
  generateObject<T>(params: {
    model: string
    schema: { parse: (v: unknown) => T }
    prompt: string
    context?: OrgContext
    temperature?: number
  }): Promise<{ object: T; usage: TokenUsage }>

  streamText(params: {
    model: string
    prompt: string
    context?: OrgContext
  }): AsyncIterable<string>

  embed(params: { model: string; texts: string[] }): Promise<number[][]>
}
