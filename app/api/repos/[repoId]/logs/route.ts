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

  // Try Redis first (live logs)
  try {
    const { getRedis } = require("@/lib/queue/redis") as typeof import("@/lib/queue/redis")
    const redis = getRedis()
    const key = `kap10:pipeline-logs:${repoId}`
    const raw = await redis.lrange(key, 0, -1)

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
