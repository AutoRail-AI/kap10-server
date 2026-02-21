/**
 * Signal debouncer — coalesces rapid push signals for the same repo.
 * Phase 5: P5-TEST-01c
 */
const pendingSignals = new Map<string, { timer: ReturnType<typeof setTimeout>; resolve: () => void }>()

export function debounceSignal(
  key: string,
  delayMs: number = 5000
): Promise<boolean> {
  return new Promise((resolve) => {
    const existing = pendingSignals.get(key)
    if (existing) {
      // Coalesce: cancel old timer, replace with new
      clearTimeout(existing.timer)
      existing.resolve() // resolve old promise with false (was debounced)
    }

    const timer = setTimeout(() => {
      pendingSignals.delete(key)
      resolve(true) // This signal wins
    }, delayMs)

    pendingSignals.set(key, {
      timer,
      resolve: () => resolve(false),
    })
  })
}

export function clearPendingSignals(): void {
  for (const [key, entry] of Array.from(pendingSignals.entries())) {
    clearTimeout(entry.timer)
    pendingSignals.delete(key)
  }
}
