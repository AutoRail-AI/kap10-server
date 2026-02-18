/**
 * RedisCacheStore — ICacheStore using Redis (ioredis).
 */

import type { ICacheStore } from "@/lib/ports/cache-store"
import { getRedis } from "@/lib/queue"

const PREFIX = "kap10:"
const RATE_PREFIX = "kap10:rl:"

export class RedisCacheStore implements ICacheStore {
  async get<T>(key: string): Promise<T | null> {
    const redis = getRedis()
    const raw = await redis.get(PREFIX + key)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return raw as unknown as T
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const redis = getRedis()
    const serialized = typeof value === "string" ? value : JSON.stringify(value)
    if (ttlSeconds != null) {
      await redis.setex(PREFIX + key, ttlSeconds, serialized)
    } else {
      await redis.set(PREFIX + key, serialized)
    }
  }

  async setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const redis = getRedis()
    const fullKey = PREFIX + key
    const result = await redis.set(fullKey, value, "EX", ttlSeconds, "NX")
    return result === "OK"
  }

  async invalidate(key: string): Promise<void> {
    const redis = getRedis()
    await redis.del(PREFIX + key)
  }

  async rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const redis = getRedis()
    const rk = RATE_PREFIX + key
    const count = await redis.incr(rk)
    if (count === 1) await redis.expire(rk, windowSeconds)
    return count <= limit
  }

  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    const start = Date.now()
    try {
      const redis = getRedis()
      await redis.ping()
      return { status: "up", latencyMs: Date.now() - start }
    } catch {
      return { status: "down", latencyMs: Date.now() - start }
    }
  }
}
