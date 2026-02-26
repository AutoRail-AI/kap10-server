import { describe, expect, it } from "vitest"
import { InMemoryCacheStore } from "@/lib/di/fakes"
import { checkRateLimit, formatRateLimitError } from "../rate-limiter"

describe("checkRateLimit", () => {
  it("allows calls within limit", async () => {
    const cache = new InMemoryCacheStore()
    const result = await checkRateLimit(cache, "user-1", {
      maxCalls: 5,
      windowSeconds: 60,
    })
    expect(result.allowed).toBe(true)
  })

  it("blocks calls exceeding limit", async () => {
    const cache = new InMemoryCacheStore()
    const config = { maxCalls: 3, windowSeconds: 60 }

    // Make 3 calls (all allowed)
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit(cache, "user-2", config)
      expect(r.allowed).toBe(true)
    }

    // 4th call should be blocked
    const blocked = await checkRateLimit(cache, "user-2", config)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterMs).toBe(60000)
  })

  it("isolates rate limits by identifier", async () => {
    const cache = new InMemoryCacheStore()
    const config = { maxCalls: 1, windowSeconds: 60 }

    await checkRateLimit(cache, "user-a", config)
    // user-a is now at limit

    // user-b should still be allowed
    const result = await checkRateLimit(cache, "user-b", config)
    expect(result.allowed).toBe(true)
  })
})

describe("formatRateLimitError", () => {
  it("returns structured error with hint", () => {
    const error = formatRateLimitError({ maxCalls: 60, windowSeconds: 60 })
    expect(error.isError).toBe(true)
    expect(error.content).toHaveLength(1)
    expect(error.content[0]!.type).toBe("text")
    expect(error.content[0]!.text).toContain("Rate limit exceeded")
    expect(error.content[0]!.text).toContain("60 calls per 60s")
  })
})
