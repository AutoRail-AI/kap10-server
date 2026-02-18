export interface ICacheStore {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>
  /** Phase 1: Atomic set-if-not-exists (e.g. webhook deduplication). Returns true if key was set, false if already existed. */
  setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean>
  invalidate(key: string): Promise<void>
  /** Rate limit: returns true if under limit, false if over limit */
  rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>
  /** Health: can we reach Redis? */
  healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }>
}
