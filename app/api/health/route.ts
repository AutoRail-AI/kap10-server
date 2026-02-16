import { NextResponse } from "next/server"
import { supabase } from "@/lib/db"
import { successResponse } from "@/lib/utils/api-response"

export async function GET() {
  try {
    // Check Supabase connection
    const { error } = await supabase.from("feature_flags").select("id").limit(1)
    const dbStatus = error ? "error" : "connected"

    // Check Redis (if available)
    let redisStatus = "unknown"
    try {
      const { getRedis } = await import("@/lib/queue/redis")
      const redis = getRedis()
      await redis.ping()
      redisStatus = "connected"
    } catch {
      redisStatus = "disconnected"
    }

    return successResponse(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        services: {
          database: dbStatus,
          redis: redisStatus,
        },
      },
      "Service is healthy"
    )
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  }
}
