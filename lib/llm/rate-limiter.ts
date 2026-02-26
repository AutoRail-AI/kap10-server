/**
 * Sliding-window rate limiter for LLM API calls.
 * In-memory, no external dependencies.
 *
 * Configured via env vars:
 *   LLM_RPM_LIMIT        — Requests per minute (0 = unlimited, default: 15)
 *   LLM_TPM_LIMIT        — Tokens per minute (0 = unlimited, default: 1000000)
 */

export interface RateLimiterConfig {
  /** Max requests per minute. 0 = unlimited. */
  rpm: number
  /** Max tokens per minute. 0 = unlimited. */
  tpm: number
}

export class RateLimiter {
  private readonly rpm: number
  private readonly tpm: number
  private readonly requestTimestamps: number[] = []
  private readonly tokenRecords: Array<{ ts: number; tokens: number }> = []

  constructor(config?: Partial<RateLimiterConfig>) {
    this.rpm = config?.rpm ?? parseInt(process.env.LLM_RPM_LIMIT ?? "15", 10)
    this.tpm = config?.tpm ?? parseInt(process.env.LLM_TPM_LIMIT ?? "1000000", 10)
  }

  /** Prune entries older than 60 seconds from the sliding window. */
  private pruneWindow(): void {
    const cutoff = Date.now() - 60_000
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0]! < cutoff) {
      this.requestTimestamps.shift()
    }
    while (this.tokenRecords.length > 0 && this.tokenRecords[0]!.ts < cutoff) {
      this.tokenRecords.shift()
    }
  }

  /** Current RPM usage in the sliding window. */
  get currentRpm(): number {
    this.pruneWindow()
    return this.requestTimestamps.length
  }

  /** Current TPM usage in the sliding window. */
  get currentTpm(): number {
    this.pruneWindow()
    return this.tokenRecords.reduce((sum: number, r) => sum + r.tokens, 0)
  }

  /**
   * Wait until a request slot is available.
   * Resolves immediately if under limits or limits are disabled (0).
   */
  async waitForSlot(): Promise<void> {
    if (this.rpm <= 0) return

     
    while (true) {
      this.pruneWindow()

      if (this.requestTimestamps.length < this.rpm) {
        // Slot available — record this request
        this.requestTimestamps.push(Date.now())
        return
      }

      // Calculate wait time: oldest request will expire from window
      const oldest = this.requestTimestamps[0]!
      const waitMs = oldest + 60_000 - Date.now() + 50 // +50ms buffer
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs))
      }
    }
  }

  /**
   * Record token usage for TPM tracking.
   * If over TPM limit, waits before returning.
   */
  async recordUsage(tokens: number): Promise<void> {
    this.tokenRecords.push({ ts: Date.now(), tokens })

    if (this.tpm <= 0) return

    this.pruneWindow()
    const currentTokens = this.tokenRecords.reduce((sum: number, r) => sum + r.tokens, 0)

    if (currentTokens > this.tpm) {
      // Wait for oldest record to expire
      const oldest = this.tokenRecords[0]
      if (oldest) {
        const waitMs = oldest.ts + 60_000 - Date.now() + 50
        if (waitMs > 0) {
          await new Promise((r) => setTimeout(r, waitMs))
        }
      }
    }
  }
}
