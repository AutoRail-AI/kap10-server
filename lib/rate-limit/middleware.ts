import { supabase } from "@/lib/db"
import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import type { Database } from "@/lib/db/types"

export type RateLimitRow = Database["public"]["Tables"]["rate_limits"]["Row"]

export interface RateLimitOptions {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Max requests per window
  keyGenerator?: (req: NextRequest) => Promise<string> // Custom key generator
}

// Rate limit middleware
export async function rateLimit(
  req: NextRequest,
  options: RateLimitOptions
): Promise<{ success: boolean; remaining: number; resetAt: Date }> {
  // Generate rate limit key
  let key: string
  if (options.keyGenerator) {
    key = await options.keyGenerator(req)
  } else {
    // Default: use user ID or IP address
    const session = await auth.api.getSession({ headers: await headers() })
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0] ||
      req.headers.get("x-real-ip") ||
      "anonymous"
    key = session?.user?.id || ip
  }

  const now = new Date()
  const resetAt = new Date(now.getTime() + options.windowMs)

  // Try to get existing rate limit record
  const { data: existing } = await supabase
    .from("rate_limits")
    .select("*")
    .eq("key", key)
    .maybeSingle()

  let count: number

  if (!existing) {
    // Create new record
    await supabase.from("rate_limits").insert({
      key,
      count: 1,
      reset_at: resetAt.toISOString(),
    })
    count = 1
  } else if (new Date(existing.reset_at) < now) {
    // Reset window
    await supabase
      .from("rate_limits")
      .update({ count: 1, reset_at: resetAt.toISOString() })
      .eq("id", existing.id)
    count = 1
  } else {
    // Increment count
    count = (existing.count || 0) + 1
    await supabase
      .from("rate_limits")
      .update({ count })
      .eq("id", existing.id)
  }

  const remaining = Math.max(0, options.maxRequests - count)

  return {
    success: count <= options.maxRequests,
    remaining,
    resetAt: existing && new Date(existing.reset_at) >= now
      ? new Date(existing.reset_at)
      : resetAt,
  }
}

// API route wrapper
export function withRateLimit(
  handler: (req: NextRequest) => Promise<NextResponse>,
  options: RateLimitOptions
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const result = await rateLimit(req, options)

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          resetAt: result.resetAt.toISOString(),
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": options.maxRequests.toString(),
            "X-RateLimit-Remaining": result.remaining.toString(),
            "X-RateLimit-Reset": result.resetAt.toISOString(),
          },
        }
      )
    }

    const response = await handler(req)

    // Add rate limit headers
    response.headers.set("X-RateLimit-Limit", options.maxRequests.toString())
    response.headers.set("X-RateLimit-Remaining", result.remaining.toString())
    response.headers.set("X-RateLimit-Reset", result.resetAt.toISOString())

    return response
  }
}
