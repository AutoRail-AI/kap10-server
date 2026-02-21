/**
 * P5.5-API-08: Prompt drift detector tests.
 */
import { describe, expect, it } from "vitest"

import { detectPromptDrift } from "../prompt-detector"

describe("detectPromptDrift", () => {
  it("returns not drifting for fewer than 3 prompts", () => {
    const result = detectPromptDrift(["fix the bug", "add a test"])
    expect(result.isDrifting).toBe(false)
    expect(result.similarity).toBe(0)
    expect(result.suggestion).toBeUndefined()
  })

  it("returns not drifting for an empty prompt list", () => {
    const result = detectPromptDrift([])
    expect(result.isDrifting).toBe(false)
    expect(result.similarity).toBe(0)
  })

  it("detects drift when 3 prompts are nearly identical", () => {
    const result = detectPromptDrift([
      "Fix the login button styling on the dashboard page",
      "Fix the login button styling on the dashboard page",
      "Fix the login button styling on the dashboard page",
    ])
    expect(result.isDrifting).toBe(true)
    expect(result.similarity).toBe(1)
    expect(result.suggestion).toBeDefined()
    expect(result.suggestion).toContain("repeating similar prompts")
  })

  it("detects drift with slightly varied repetitive prompts", () => {
    const result = detectPromptDrift([
      "Fix the authentication error in the login handler",
      "Please fix the authentication error in the login handler function",
      "Can you fix the authentication error in login handler?",
      "Fix authentication error in the login handler please",
    ])
    expect(result.isDrifting).toBe(true)
    expect(result.similarity).toBeGreaterThan(0.7)
  })

  it("does not flag genuinely different prompts as drifting", () => {
    const result = detectPromptDrift([
      "Add a new REST endpoint for user profiles",
      "Write unit tests for the payment processing module",
      "Refactor the database connection pooling logic",
      "Create a CI/CD pipeline configuration for GitHub Actions",
    ])
    expect(result.isDrifting).toBe(false)
  })

  it("respects a custom threshold", () => {
    const prompts = [
      "Update the user dashboard component",
      "Update the admin dashboard component",
      "Update the manager dashboard component",
    ]

    // With a very low threshold, these should be flagged
    const lowThreshold = detectPromptDrift(prompts, 0.3)
    expect(lowThreshold.isDrifting).toBe(true)

    // With a very high threshold, these should not be flagged
    const highThreshold = detectPromptDrift(prompts, 0.95)
    expect(highThreshold.isDrifting).toBe(false)
  })

  it("returns similarity score between 0 and 1", () => {
    const result = detectPromptDrift([
      "Implement caching for the API routes",
      "Add Redis caching for the database queries",
      "Set up caching layer for external API calls",
    ])
    expect(result.similarity).toBeGreaterThanOrEqual(0)
    expect(result.similarity).toBeLessThanOrEqual(1)
  })

  it("handles single-word prompts gracefully", () => {
    // "fix" has length 3, so it passes the tokenizer filter
    // Three identical prompts should be detected as drift
    const result = detectPromptDrift(["fix", "fix", "fix"])
    expect(result).toBeDefined()
    expect(result.isDrifting).toBe(true)
    expect(result.similarity).toBe(1)
  })

  it("returns not drifting when all tokens are too short to match", () => {
    // "go" and "do" have length <= 2, filtered out by tokenizer
    // Empty token sets yield Jaccard similarity of 0
    const result = detectPromptDrift(["go", "go", "go"])
    expect(result).toBeDefined()
    expect(result.isDrifting).toBe(false)
    expect(result.similarity).toBe(0)
  })

  it("handles prompts with special characters", () => {
    const result = detectPromptDrift([
      "Fix bug #1234: TypeError in auth.ts",
      "Fix bug #1234: TypeError in auth.ts (retry)",
      "Fix bug #1234: TypeError in auth.ts again",
    ])
    expect(result.isDrifting).toBe(true)
  })
})
