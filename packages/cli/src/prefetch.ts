/**
 * Phase 10b: Pre-fetch debounce module.
 *
 * Fires predictive context pre-warming requests to the cloud
 * when the user's cursor changes. Debounces at 500ms, rate limits
 * to 2 requests/second, and fails silently.
 */

export interface PrefetchContext {
  filePath: string
  line?: number
  entityKey?: string
  repoId: string
}

export class PrefetchManager {
  private serverUrl: string
  private apiKey: string
  private debounceMs: number
  private minIntervalMs: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastSentAt = 0
  private disposed = false

  constructor(opts: {
    serverUrl: string
    apiKey: string
    debounceMs?: number
    minIntervalMs?: number
  }) {
    this.serverUrl = opts.serverUrl
    this.apiKey = opts.apiKey
    this.debounceMs = opts.debounceMs ?? 500
    this.minIntervalMs = opts.minIntervalMs ?? 500 // 2/s rate limit
  }

  /**
   * Called on cursor change. Debounces and rate-limits before firing.
   */
  onCursorChange(context: PrefetchContext): void {
    if (this.disposed) return

    // Clear previous debounce timer
    if (this.timer) {
      clearTimeout(this.timer)
    }

    this.timer = setTimeout(() => {
      this.firePrefetch(context)
    }, this.debounceMs)
  }

  /**
   * Fire the prefetch request. Rate-limited and fire-and-forget.
   */
  private firePrefetch(context: PrefetchContext): void {
    const now = Date.now()
    if (now - this.lastSentAt < this.minIntervalMs) return

    this.lastSentAt = now

    // Fire-and-forget POST — silent errors
    fetch(`${this.serverUrl}/api/prefetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        filePath: context.filePath,
        line: context.line,
        entityKey: context.entityKey,
        repoId: context.repoId,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      // Silent failure — prefetch is best-effort
    })
  }

  /**
   * Clean up timers.
   */
  dispose(): void {
    this.disposed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
