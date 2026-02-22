/**
 * Phase 10b TEST-05: Pre-fetch debounce module tests.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { PrefetchManager } from "../prefetch.js"

describe("PrefetchManager", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchSpy)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("debounces rapid cursor changes", () => {
    const manager = new PrefetchManager({
      serverUrl: "https://api.example.com",
      apiKey: "test-key",
      debounceMs: 500,
      minIntervalMs: 500,
    })

    // Fire 5 rapid cursor changes
    manager.onCursorChange({ filePath: "src/a.ts", repoId: "repo-1" })
    manager.onCursorChange({ filePath: "src/b.ts", repoId: "repo-1" })
    manager.onCursorChange({ filePath: "src/c.ts", repoId: "repo-1" })
    manager.onCursorChange({ filePath: "src/d.ts", repoId: "repo-1" })
    manager.onCursorChange({ filePath: "src/e.ts", repoId: "repo-1" })

    // Before debounce fires
    expect(fetchSpy).not.toHaveBeenCalled()

    // Advance past debounce
    vi.advanceTimersByTime(600)

    // Only the last call should fire
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const callBody = JSON.parse(fetchSpy.mock.calls[0]![1].body as string) as { filePath: string }
    expect(callBody.filePath).toBe("src/e.ts")

    manager.dispose()
  })

  it("rate limits to 2 requests/second", () => {
    const manager = new PrefetchManager({
      serverUrl: "https://api.example.com",
      apiKey: "test-key",
      debounceMs: 50,
      minIntervalMs: 500,
    })

    // First call
    manager.onCursorChange({ filePath: "src/a.ts", repoId: "repo-1" })
    vi.advanceTimersByTime(60)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Second call too soon (within minIntervalMs)
    manager.onCursorChange({ filePath: "src/b.ts", repoId: "repo-1" })
    vi.advanceTimersByTime(60)
    // Should be rate-limited — still 1 call
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // After rate limit window
    vi.advanceTimersByTime(500)
    manager.onCursorChange({ filePath: "src/c.ts", repoId: "repo-1" })
    vi.advanceTimersByTime(60)
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    manager.dispose()
  })

  it("sends correct request shape", () => {
    const manager = new PrefetchManager({
      serverUrl: "https://api.example.com",
      apiKey: "test-key",
      debounceMs: 50,
    })

    manager.onCursorChange({
      filePath: "src/auth.ts",
      line: 42,
      entityKey: "fn-login",
      repoId: "repo-123",
    })
    vi.advanceTimersByTime(60)

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/api/prefetch",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    )

    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body as string) as Record<string, unknown>
    expect(body.filePath).toBe("src/auth.ts")
    expect(body.line).toBe(42)
    expect(body.entityKey).toBe("fn-login")
    expect(body.repoId).toBe("repo-123")

    manager.dispose()
  })

  it("silently handles fetch errors", () => {
    fetchSpy.mockRejectedValue(new Error("Network error"))

    const manager = new PrefetchManager({
      serverUrl: "https://api.example.com",
      apiKey: "test-key",
      debounceMs: 50,
    })

    // Should not throw
    manager.onCursorChange({ filePath: "src/a.ts", repoId: "repo-1" })
    vi.advanceTimersByTime(60)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    manager.dispose()
  })

  it("stops firing after dispose", () => {
    const manager = new PrefetchManager({
      serverUrl: "https://api.example.com",
      apiKey: "test-key",
      debounceMs: 50,
    })

    manager.onCursorChange({ filePath: "src/a.ts", repoId: "repo-1" })
    manager.dispose()

    vi.advanceTimersByTime(100)
    expect(fetchSpy).not.toHaveBeenCalled()

    // Calls after dispose should be ignored
    manager.onCursorChange({ filePath: "src/b.ts", repoId: "repo-1" })
    vi.advanceTimersByTime(100)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
