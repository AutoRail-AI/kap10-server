import { describe, it, expect, vi, beforeEach } from "vitest"
import { MockLLMProvider } from "@/lib/di/fakes"
import { LLM_MODELS } from "@/lib/llm/config"
import { summarizeLedger } from "../summarizer"

describe("summarizeLedger", () => {
  let llm: MockLLMProvider

  beforeEach(() => {
    llm = new MockLLMProvider()
  })

  it("returns the LLM-generated narrative string", async () => {
    vi.spyOn(llm, "generateObject").mockResolvedValue({
      object: { narrative: "The developer refactored the auth module to use JWT tokens." },
      usage: { inputTokens: 100, outputTokens: 30 },
    })

    const result = await summarizeLedger(llm, {
      prNumber: 42,
      sourceBranch: "feature/jwt-auth",
      targetBranch: "main",
      prompts: ["Refactor auth module", "Add JWT support"],
      entryCount: 2,
    })

    expect(result).toBe("The developer refactored the auth module to use JWT tokens.")
  })

  it("calls generateObject with the correct model and prompt structure", async () => {
    const spy = vi.spyOn(llm, "generateObject").mockResolvedValue({
      object: { narrative: "Code was updated." },
      usage: { inputTokens: 50, outputTokens: 10 },
    })

    await summarizeLedger(llm, {
      prNumber: 7,
      sourceBranch: "fix/bug-123",
      targetBranch: "main",
      prompts: ["Fix null pointer bug"],
      entryCount: 1,
    })

    expect(spy).toHaveBeenCalledOnce()
    const callArgs = spy.mock.calls[0]![0]
    expect(callArgs.model).toBe(LLM_MODELS.standard)
    expect(callArgs.prompt).toContain("PR #7")
    expect(callArgs.prompt).toContain("fix/bug-123")
    expect(callArgs.prompt).toContain("main")
    expect(callArgs.prompt).toContain("1. Fix null pointer bug")
  })

  it("handles zero prompts gracefully", async () => {
    vi.spyOn(llm, "generateObject").mockResolvedValue({
      object: { narrative: "No changes were made during this session." },
      usage: { inputTokens: 20, outputTokens: 10 },
    })

    const result = await summarizeLedger(llm, {
      prNumber: 1,
      sourceBranch: "feat/empty",
      targetBranch: "develop",
      prompts: [],
      entryCount: 0,
    })

    expect(result).toBe("No changes were made during this session.")
  })

  it("handles 5 prompts without truncation", async () => {
    const prompts = Array.from({ length: 5 }, (_, i) => `Step ${i + 1}: implement feature`)

    const spy = vi.spyOn(llm, "generateObject").mockResolvedValue({
      object: { narrative: "Five steps were completed." },
      usage: { inputTokens: 200, outputTokens: 20 },
    })

    const result = await summarizeLedger(llm, {
      prNumber: 5,
      sourceBranch: "feature/multi-step",
      targetBranch: "main",
      prompts,
      entryCount: 5,
    })

    expect(result).toBe("Five steps were completed.")
    const callPrompt = spy.mock.calls[0]![0].prompt
    // All 5 prompts should appear in the prompt
    for (let i = 1; i <= 5; i++) {
      expect(callPrompt).toContain(`${i}. Step ${i}: implement feature`)
    }
  })

  it("truncates prompts to the first 20 when 25 are provided", async () => {
    const prompts = Array.from({ length: 25 }, (_, i) => `Prompt number ${i + 1}`)

    const spy = vi.spyOn(llm, "generateObject").mockResolvedValue({
      object: { narrative: "A large session was summarized." },
      usage: { inputTokens: 500, outputTokens: 40 },
    })

    await summarizeLedger(llm, {
      prNumber: 99,
      sourceBranch: "feature/big-session",
      targetBranch: "main",
      prompts,
      entryCount: 25,
    })

    const callPrompt = spy.mock.calls[0]![0].prompt

    // Prompt 20 should be included
    expect(callPrompt).toContain("20. Prompt number 20")
    // Prompt 21 should be excluded due to truncation
    expect(callPrompt).not.toContain("21. Prompt number 21")
  })

  it("includes entryCount in the generated prompt", async () => {
    const spy = vi.spyOn(llm, "generateObject").mockResolvedValue({
      object: { narrative: "Session with 12 interactions." },
      usage: { inputTokens: 300, outputTokens: 25 },
    })

    await summarizeLedger(llm, {
      prNumber: 15,
      sourceBranch: "chore/update-deps",
      targetBranch: "main",
      prompts: ["Update package.json"],
      entryCount: 12,
    })

    const callPrompt = spy.mock.calls[0]![0].prompt
    expect(callPrompt).toContain("Total interactions: 12")
  })

  it("returns the narrative from the LLM response object directly", async () => {
    const expectedNarrative = "The team migrated the legacy payment module to the new Stripe SDK, updating 8 files and resolving 3 deprecated API calls."

    vi.spyOn(llm, "generateObject").mockResolvedValue({
      object: { narrative: expectedNarrative },
      usage: { inputTokens: 400, outputTokens: 60 },
    })

    const narrative = await summarizeLedger(llm, {
      prNumber: 101,
      sourceBranch: "feat/stripe-v3",
      targetBranch: "main",
      prompts: ["Migrate Stripe SDK", "Update payment handlers", "Fix deprecated calls"],
      entryCount: 3,
    })

    expect(narrative).toBe(expectedNarrative)
  })
})
