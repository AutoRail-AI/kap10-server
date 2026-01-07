import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { connectDB } from "@/lib/db/mongoose"
import mongoose, { Schema } from "mongoose"

export interface IRateLimit extends mongoose.Document {
  key: string
  count: number
  resetAt: Date
  createdAt: Date
}

const RateLimitSchema = new Schema<IRateLimit>(
  {
    key: { type: String, required: true, unique: true, index: true },
    count: { type: Number, default: 0 },
    resetAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
)

// TTL index for auto-cleanup
RateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 })

export const RateLimit =
  mongoose.models.RateLimit ||
  mongoose.model<IRateLimit>("RateLimit", RateLimitSchema)

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
  await connectDB()

  // Generate rate limit key
  let key: string
  if (options.keyGenerator) {
    key = await options.keyGenerator(req)
  } else {
    // Default: use user ID or IP address
    const session = await auth.api.getSession({ headers: await headers() })
    key = session?.user?.id || req.ip || "anonymous"
  }

  const now = new Date()
  const resetAt = new Date(now.getTime() + options.windowMs)

  // Get or create rate limit record
  let rateLimit = await RateLimit.findOne({ key })

  if (!rateLimit) {
    rateLimit = await RateLimit.create({
      key,
      count: 1,
      resetAt,
    })
  } else if (rateLimit.resetAt < now) {
    // Reset window
    rateLimit.count = 1
    rateLimit.resetAt = resetAt
    await rateLimit.save()
  } else {
    // Increment count
    rateLimit.count += 1
    await rateLimit.save()
  }

  const remaining = Math.max(0, options.maxRequests - rateLimit.count)

  return {
    success: rateLimit.count <= options.maxRequests,
    remaining,
    resetAt: rateLimit.resetAt,
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

