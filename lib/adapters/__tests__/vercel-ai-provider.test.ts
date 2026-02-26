/**
 * P4-TEST-11: Provider error handling tests for VercelAIProvider.
 *
 * Since VercelAIProvider uses require() at runtime, we test it
 * through the ILLMProvider interface contract with the MockLLMProvider,
 * and test that the VercelAIProvider constructor and method signatures are correct.
 */
import { describe, expect, it } from "vitest"
import { MockLLMProvider } from "@/lib/di/fakes"

describe("VercelAIProvider contract", () => {
  it("MockLLMProvider implements ILLMProvider interface", () => {
    const provider = new MockLLMProvider()
    expect(typeof provider.generateObject).toBe("function")
    expect(typeof provider.streamText).toBe("function")
    expect(typeof provider.embed).toBe("function")
  })

  it("generateObject returns parsed result via schema.parse", async () => {
    const provider = new MockLLMProvider()
    const schema = {
      parse: (_v: unknown) => ({ taxonomy: "VERTICAL" as const, confidence: 0.9 }),
    }

    const result = await provider.generateObject({ schema, prompt: "test", model: "gpt-4o-mini" })
    expect(result.object.taxonomy).toBe("VERTICAL")
    expect(result.usage.inputTokens).toBe(0)
    expect(result.usage.outputTokens).toBe(0)
  })

  it("generateObject propagates schema parse errors", async () => {
    const provider = new MockLLMProvider()
    const schema = {
      parse: () => {
        throw new Error("Schema validation failed")
      },
    }

    await expect(
      provider.generateObject({ schema, prompt: "test", model: "gpt-4o-mini" })
    ).rejects.toThrow("Schema validation failed")
  })

  it("streamText yields string chunks", async () => {
    const provider = new MockLLMProvider()
    const chunks: string[] = []
    for await (const chunk of provider.streamText({ prompt: "test", model: "gpt-4o-mini" })) {
      chunks.push(chunk)
    }
    expect(chunks).toHaveLength(1)
  })

  it("embed returns empty array", async () => {
    const provider = new MockLLMProvider()
    const result = await provider.embed({ model: "text-embedding-3-small", texts: ["hello"] })
    expect(result).toEqual([])
  })
})

describe("VercelAIProvider class", () => {
  it("can be imported and instantiated", async () => {
    const { VercelAIProvider } = await import("../vercel-ai-provider")
    const provider = new VercelAIProvider()
    expect(typeof provider.generateObject).toBe("function")
    expect(typeof provider.streamText).toBe("function")
    expect(typeof provider.embed).toBe("function")
  })

  it("generateObject throws when AI SDK is not configured", async () => {
    // With a fake API key, the provider should fail at the AI SDK level
    const origKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = ""

    const { VercelAIProvider } = await import("../vercel-ai-provider")
    const provider = new VercelAIProvider()

    const schema = { parse: (v: unknown) => v }

    await expect(
      provider.generateObject({ model: "gpt-4o-mini", schema, prompt: "test" })
    ).rejects.toThrow()

    process.env.OPENAI_API_KEY = origKey
  })
})
