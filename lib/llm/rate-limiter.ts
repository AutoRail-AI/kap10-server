/**
 * Sliding-window rate limiter for LLM API calls.
 * In-memory, no external dependencies.
 *
 * Configured via env vars:
 *   LLM_RPM_LIMIT        — Requests per minute (0 = unlimited, default: 15)
 *   LLM_TPM_LIMIT        — Tokens per minute (0 = unlimited, default: auto from provider)
 *
 * When LLM_TPM_LIMIT is not set, the limiter auto-detects the provider's TPM
 * from MODEL_TPM_LIMITS in config.ts, preventing 429s from misconfigured defaults.
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
    // Auto-detect TPM from provider config when not explicitly set
    const envTpm = process.env.LLM_TPM_LIMIT
    if (config?.tpm != null) {
      this.tpm = config.tpm
    } else if (envTpm != null) {
      this.tpm = parseInt(envTpm, 10)
    } else {
      // Lazy import to avoid circular dependency at module load
      try {
        const { getProviderTpmLimit } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")
        this.tpm = getProviderTpmLimit()
      } catch {
        this.tpm = 200_000 // Safe fallback
      }
    }
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
   * Wait until estimated tokens fit within the TPM budget.
   * Call BEFORE making the LLM request to avoid slamming provider limits.
   * @param estimatedTokens — rough estimate of tokens this request will consume
   */
  async waitForTokenBudget(estimatedTokens: number): Promise<void> {
    if (this.tpm <= 0) return

    while (true) {
      this.pruneWindow()
      const currentTokens = this.tokenRecords.reduce((sum: number, r) => sum + r.tokens, 0)

      if (currentTokens + estimatedTokens <= this.tpm) {
        return // Enough budget
      }

      // Wait for oldest record to expire from the window
      const oldest = this.tokenRecords[0]
      if (oldest) {
        const waitMs = oldest.ts + 60_000 - Date.now() + 100
        if (waitMs > 0) {
          await new Promise((r) => setTimeout(r, Math.min(waitMs, 5_000)))
        }
      } else {
        return // No records, should have budget
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

