import Redis from "ioredis"

// Lazy initialization - only get URL when actually needed (at runtime, not build time)
function getRedisUrl(): string {
  return process.env.REDIS_URL || "redis://localhost:6379"
}

// Singleton pattern for Redis connection
let redisInstance: Redis | null = null

/**
 * Get Redis connection instance (lazy initialization)
 * Only creates connection at runtime when actually called, not during build
 */
export function getRedis(): Redis {
  if (!redisInstance) {
    // Only create connection at runtime, not during build
    // getRedisUrl() is only called here, not at module load time
    const url = getRedisUrl()
    redisInstance = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // Use lazyConnect to prevent connection during build
      lazyConnect: true,
      // Retry strategy: don't retry indefinitely during build
      retryStrategy: (times) => {
        // During build, don't retry (times will be 0 or very low)
        // At runtime, allow normal retries
        if (process.env.NODE_ENV === "production" || times < 5) {
          return Math.min(times * 50, 2000)
        }
        return null // Stop retrying after 5 attempts
      },
    })

    // Only set up event handlers if not in build context
    if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
      redisInstance.on("error", (error: unknown) => {
        console.error("Redis connection error:", error)
      })

      redisInstance.on("connect", () => {
        console.log("Redis connected")
      })
    }

    // Attempt to connect, but fail silently during build
    redisInstance.connect().catch((error: unknown) => {
      // Silently handle connection errors during build/initialization
      // Only log in development mode
      if (process.env.NODE_ENV === "development") {
        const message = error instanceof Error ? error.message : String(error)
        console.warn("Redis connection failed (this is OK during build):", message)
      }
    })
  }

  return redisInstance
}

/**
 * Close the Redis connection gracefully
 */
export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.quit()
    } catch {
      // Ignore errors during shutdown
      // This can happen if connection was never established
      // Type assertion to handle unknown error type
    }
    redisInstance = null
  }
}
