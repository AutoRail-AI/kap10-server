import { NextRequest, NextResponse } from "next/server"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse } from "@/lib/utils/api-response"

interface PipelineLogEntry {
  timestamp: string
  level: string
  phase: string
  step: string
  message: string
  meta?: Record<string, unknown>
}

function formatLogText(logs: PipelineLogEntry[]): string {
  return logs
    .map(
      (e) =>
        `[${e.timestamp}] [${e.level.toUpperCase().padEnd(5)}] [${e.phase}] ${e.step ? `${e.step} — ` : ""}${e.message}`
    )
    .join("\n")
}

export const GET = withAuth(async (req: NextRequest) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/logs\/download/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }

  const orgId = await getActiveOrgId()
  if (!orgId) {
    return errorResponse("No organization", 400)
  }

  let logs: PipelineLogEntry[] = []

  // Try Redis first
  try {
    const { getRedis } = require("@/lib/queue/redis") as typeof import("@/lib/queue/redis")
    const redis = getRedis()
    const key = `kap10:pipeline-logs:${repoId}`
    const raw = await redis.lrange(key, 0, -1)
    if (raw.length > 0) {
      logs = raw.map((r) => JSON.parse(r) as PipelineLogEntry)
    }
  } catch {
    // fall through
  }

  // Try archive if Redis empty
  if (logs.length === 0) {
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
          logs = JSON.parse(text) as PipelineLogEntry[]
        }
      }
    } catch {
      // no archive
    }
  }

  if (logs.length === 0) {
    return errorResponse("No pipeline logs found", 404)
  }

  const text = formatLogText(logs)
  return new NextResponse(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="pipeline-logs-${repoId}.log"`,
    },
  })
})
