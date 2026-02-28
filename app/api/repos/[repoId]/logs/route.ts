import { NextRequest } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"

interface PipelineLogEntry {
  timestamp: string
  level: "info" | "warn" | "error"
  phase: string
  step: string
  message: string
  meta?: Record<string, unknown>
}

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/logs/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }

  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  const runId = req.nextUrl.searchParams.get("runId")

  // Try Redis first (live logs)
  try {
    const { getRedis } = require("@/lib/queue/redis") as typeof import("@/lib/queue/redis")
    const redis = getRedis()

    // Try run-specific key first, then latest pointer, then legacy key
    let key: string | null = null
    if (runId) {
      key = `unerr:pipeline-logs:${repoId}:${runId}`
    } else {
      // Check if there's a latest pointer
      const latestRunId = await redis.get(`unerr:pipeline-logs:${repoId}:latest`)
      if (latestRunId) {
        key = `unerr:pipeline-logs:${repoId}:${latestRunId}`
      }
    }

    // Try the run-specific key first
    if (key) {
      const raw = await redis.lrange(key, 0, 2000)
      if (raw.length > 0) {
        const logs: PipelineLogEntry[] = raw.map((r) => JSON.parse(r) as PipelineLogEntry)
        return successResponse({ source: "live" as const, logs, count: logs.length })
      }
    }

    // Fall back to legacy key
    const legacyKey = `unerr:pipeline-logs:${repoId}`
    const raw = await redis.lrange(legacyKey, 0, 2000)

    if (raw.length > 0) {
      const logs: PipelineLogEntry[] = raw.map((r) => JSON.parse(r) as PipelineLogEntry)
      return successResponse({ source: "live" as const, logs, count: logs.length })
    }
  } catch {
    // Redis unavailable — fall through to archive
  }

  // Try Supabase Storage archive
  try {
    const { supabase } = require("@/lib/db") as typeof import("@/lib/db")
    const { data: files } = await supabase.storage
      .from("pipeline-logs")
      .list(`${orgId}/${repoId}`, {
        limit: 1,
        sortBy: { column: "name", order: "desc" },
      })

    const jsonFile = files?.find((f: { name: string }) => f.name.endsWith(".json"))
    if (jsonFile) {
      const { data } = await supabase.storage
        .from("pipeline-logs")
        .download(`${orgId}/${repoId}/${jsonFile.name}`)

      if (data) {
        const text = await data.text()
        const logs = JSON.parse(text) as PipelineLogEntry[]
        return successResponse({ source: "archived" as const, logs, count: logs.length })
      }
    }
  } catch {
    // Archive unavailable
  }

  return successResponse({ source: "none" as const, logs: [] as PipelineLogEntry[], count: 0 })
})
