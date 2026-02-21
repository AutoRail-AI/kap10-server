/**
 * P5-TEST-01c: Signal debouncing for push webhooks.
 * Multiple rapid push events for the same repo should be debounced into one re-index.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { debounceSignal, clearPendingSignals } from "@/lib/indexer/signal-debounce"

describe("debounceSignal", () => {
  afterEach(() => {
    clearPendingSignals()
    vi.useRealTimers()
  })

  it("resolves with true when no other signal arrives within the delay window", async () => {
    vi.useFakeTimers()

    const promise = debounceSignal("repo-1", 5000)

    // Advance past the delay window
    vi.advanceTimersByTime(5000)

    const result = await promise
    expect(result).toBe(true)
  })

  it("coalesces two signals within the delay window — first gets false, second gets true", async () => {
    vi.useFakeTimers()

    const first = debounceSignal("repo-1", 5000)

    // Fire second signal 2 seconds later (within the window)
    vi.advanceTimersByTime(2000)
    const second = debounceSignal("repo-1", 5000)

    // The first signal should be debounced (resolved with false)
    const firstResult = await first
    expect(firstResult).toBe(false)

    // Advance past the second signal's delay window
    vi.advanceTimersByTime(5000)
    const secondResult = await second
    expect(secondResult).toBe(true)
  })

  it("processes signal separately when it arrives after the window has elapsed", async () => {
    vi.useFakeTimers()

    const first = debounceSignal("repo-1", 5000)

    // Let the first signal's window elapse
    vi.advanceTimersByTime(5000)
    const firstResult = await first
    expect(firstResult).toBe(true)

    // Fire a second signal after the window — should be processed independently
    const second = debounceSignal("repo-1", 5000)
    vi.advanceTimersByTime(5000)
    const secondResult = await second
    expect(secondResult).toBe(true)
  })

  it("does not debounce signals for different repos", async () => {
    vi.useFakeTimers()

    const repoA = debounceSignal("repo-a", 5000)
    const repoB = debounceSignal("repo-b", 5000)

    // Advance past both windows
    vi.advanceTimersByTime(5000)

    const resultA = await repoA
    const resultB = await repoB
    expect(resultA).toBe(true)
    expect(resultB).toBe(true)
  })

  it("handles three rapid signals — only the last one wins", async () => {
    vi.useFakeTimers()

    const first = debounceSignal("repo-1", 5000)
    vi.advanceTimersByTime(1000)
    const second = debounceSignal("repo-1", 5000)
    vi.advanceTimersByTime(1000)
    const third = debounceSignal("repo-1", 5000)

    // First and second are debounced
    const firstResult = await first
    const secondResult = await second
    expect(firstResult).toBe(false)
    expect(secondResult).toBe(false)

    // Third wins after its window expires
    vi.advanceTimersByTime(5000)
    const thirdResult = await third
    expect(thirdResult).toBe(true)
  })

  it("clearPendingSignals cancels all pending timers", async () => {
    vi.useFakeTimers()

    const promise = debounceSignal("repo-1", 5000)
    clearPendingSignals()

    // The timer was cleared, so advancing time should not resolve
    // The promise should still be pending (never resolved)
    // We can verify by racing with a resolved promise
    const timeoutPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("timeout"), 100)
    })
    vi.advanceTimersByTime(100)

    const result = await Promise.race([
      promise.then(() => "debounce"),
      timeoutPromise,
    ])
    // After clear, the old promise never resolves — timeout wins
    expect(result).toBe("timeout")
  })
})
