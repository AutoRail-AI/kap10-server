import { NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"

const CHECK_TIMEOUT_MS = 2_000
const TOTAL_TIMEOUT_MS = 5_000

type CheckStatus = "up" | "down" | "unconfigured"

interface CheckResult {
  status: CheckStatus
  latencyMs?: number
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  const timeout = new Promise<null>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms)
  )
  try {
    return await Promise.race([promise, timeout])
  } catch {
    return null
  }
}

export async function GET() {
  const start = Date.now()
  const container = getContainer()

  const runCheck = async (
    _name: string,
    fn: () => Promise<{ status: CheckStatus; latencyMs?: number }>
  ): Promise<{ status: CheckStatus; latencyMs?: number }> => {
    const t0 = Date.now()
    try {
      const result = await withTimeout(fn(), CHECK_TIMEOUT_MS)
      return result ?? { status: "down" as CheckStatus, latencyMs: Date.now() - t0 }
    } catch {
      return { status: "down" as CheckStatus, latencyMs: Date.now() - t0 }
    }
  }

  const [supabase, arangodb, temporal, redis, langfuse] = await Promise.allSettled([
    runCheck("supabase", () => container.relationalStore.healthCheck()),
    runCheck("arangodb", () => container.graphStore.healthCheck()),
    runCheck("temporal", () => container.workflowEngine.healthCheck()),
    runCheck("redis", () => container.cacheStore.healthCheck()),
    runCheck("langfuse", () => container.observability.healthCheck()),
  ])

  const checks: Record<string, CheckResult> = {
    supabase:
      supabase.status === "fulfilled"
        ? supabase.value
        : { status: "down" },
    arangodb:
      arangodb.status === "fulfilled"
        ? arangodb.value
        : { status: "down" },
    temporal:
      temporal.status === "fulfilled"
        ? temporal.value
        : { status: "down" },
    redis:
      redis.status === "fulfilled"
        ? redis.value
        : { status: "down" },
    langfuse:
      langfuse.status === "fulfilled"
        ? langfuse.value
        : { status: "down" },
  }

  const supabaseDown = checks.supabase.status === "down"
  const anyOtherDown =
    checks.arangodb.status === "down" ||
    checks.temporal.status === "down" ||
    checks.redis.status === "down"
  const overallStatus = supabaseDown
    ? "unhealthy"
    : anyOtherDown
      ? "degraded"
      : "healthy"

  const body = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks: Object.fromEntries(
      Object.entries(checks).map(([k, v]) => [
        k,
        { status: v.status, latencyMs: v.latencyMs },
      ])
    ),
  }

  if (Date.now() - start > TOTAL_TIMEOUT_MS) {
    console.warn("[health] Total health check exceeded 5s budget")
  }

  if (supabaseDown) {
    return NextResponse.json(body, { status: 503 })
  }
  return NextResponse.json(body, { status: 200 })
}
