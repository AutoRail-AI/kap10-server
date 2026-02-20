/**
 * Sliding window rate limiter for MCP tool calls.
 * Uses ICacheStore.rateLimit() which maps to Redis sliding window.
 * Default: 60 tool calls per 60-second window per API key.
 */

import type { ICacheStore } from "@/lib/ports/cache-store"

export interface RateLimitConfig {
  maxCalls: number
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterMs?: number
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxCalls: parseInt(process.env.MCP_RATE_LIMIT_MAX ?? "60", 10),
  windowSeconds: parseInt(process.env.MCP_RATE_LIMIT_WINDOW_S ?? "60", 10),
}

/**
 * Check rate limit for a given identifier (API key hash or user ID).
 * Returns whether the call is allowed and remaining quota.
 */
export async function checkRateLimit(
  cacheStore: ICacheStore,
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): Promise<RateLimitResult> {
  const key = `rate:mcp:${identifier}`
  const allowed = await cacheStore.rateLimit(key, config.maxCalls, config.windowSeconds)

  if (!allowed) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: config.windowSeconds * 1000,
    }
  }

  // We don't have exact remaining count from the cache interface,
  // but the rateLimit method tracks internally
  return {
    allowed: true,
    remaining: -1, // unknown exact count
  }
}

/**
 * Format rate limit error for MCP tool result.
 * Returns a structured error that agents can parse and self-correct.
 */
export function formatRateLimitError(config: RateLimitConfig = DEFAULT_CONFIG): {
  isError: true
  content: Array<{ type: "text"; text: string }>
} {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Rate limit exceeded. You are calling tools too rapidly — this usually means the agent is in a loop. Pause, review your context, and ask the user for clarification before continuing. Limit: ${config.maxCalls} calls per ${config.windowSeconds}s window.`,
      },
    ],
  }
}
