import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"

/**
 * SSE endpoint for streaming real-time repo events.
 *
 * Replaces 4 separate polling loops (status, logs, activity, MCP sessions)
 * with a single server-sent event stream. The server polls internally at 2s
 * and only pushes data when it has changed (delta detection via JSON comparison).
 *
 * Events emitted:
 *   - `status`  — { status, progress, indexingStartedAt, errorMessage }
 *   - `logs`    — { source, logs[], count }
 *   - `heartbeat` — {} (keep-alive every 15s)
 *
 * The connection stays open while the pipeline is active (indexing/embedding/justifying).
 * When the pipeline reaches a terminal state (ready/error/*_failed), a final `status`
 * event is sent and the stream closes. Clients should use EventSource auto-reconnect.
 */

const ACTIVE_STATUSES = new Set(["pending", "indexing", "embedding", "justifying", "ontology"])
const POLL_INTERVAL_MS = 2_000
const HEARTBEAT_INTERVAL_MS = 15_000

interface PipelineLogEntry {
  timestamp: string
  level: "info" | "warn" | "error"
  phase: string
  step: string
  message: string
  meta?: Record<string, unknown>
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const { repoId } = await params

  // Auth check
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return new Response("Unauthorized", { status: 401 })
  }

  let orgId: string
  try {
    orgId = await getActiveOrgId()
  } catch {
    return new Response("No organization", { status: 400 })
  }

  const encoder = new TextEncoder()
  let aborted = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (aborted) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          aborted = true
        }
      }

      // Abort handling
      req.signal.addEventListener("abort", () => {
        aborted = true
        try { controller.close() } catch { /* already closed */ }
      })

      const container = getContainer()
      let lastStatusJson = ""
      let lastLogCount = -1

      const poll = async () => {
        if (aborted) return false

        // --- Status ---
        try {
          const repo = await container.relationalStore.getRepo(orgId, repoId)
          if (!repo) {
            send("error", { message: "Repo not found" })
            return false
          }

          const statusPayload = {
            status: repo.status,
            progress: repo.indexProgress ?? 0,
            indexingStartedAt: repo.indexingStartedAt
              ? new Date(repo.indexingStartedAt).getTime()
              : null,
            errorMessage: repo.errorMessage ?? null,
            fileCount: repo.fileCount,
            functionCount: repo.functionCount,
            classCount: repo.classCount,
          }

          // Check for workflow progress if indexing
          if (repo.status === "indexing" && repo.workflowId) {
            try {
              const wfStatus = await container.workflowEngine.getWorkflowStatus(repo.workflowId)
              statusPayload.status = wfStatus.status === "RUNNING" ? "indexing" : repo.status
              statusPayload.progress = wfStatus.progress ?? repo.indexProgress ?? 0
            } catch {
              // Use DB values
            }
          }

          const statusJson = JSON.stringify(statusPayload)
          if (statusJson !== lastStatusJson) {
            lastStatusJson = statusJson
            send("status", statusPayload)
          }

          // If terminal, send final status and close
          if (!ACTIVE_STATUSES.has(repo.status)) {
            return false // Signal to stop polling
          }
        } catch {
          // DB error — skip this tick
        }

        // --- Logs ---
        try {
          const { getRedis } = require("@/lib/queue/redis") as typeof import("@/lib/queue/redis")
          const redis = getRedis()
          const key = `kap10:pipeline-logs:${repoId}`
          const raw = await redis.lrange(key, 0, 2000)

          if (raw.length !== lastLogCount) {
            lastLogCount = raw.length
            const logs: PipelineLogEntry[] = raw.map((r) => JSON.parse(r) as PipelineLogEntry)
            send("logs", { source: "live", logs, count: logs.length })
          }
        } catch {
          // Redis unavailable — skip logs this tick
        }

        return true // Continue polling
      }

      // Send initial state
      const shouldContinue = await poll()

      if (shouldContinue && !aborted) {
        // Heartbeat timer
        const heartbeatId = setInterval(() => {
          if (aborted) return
          send("heartbeat", {})
        }, HEARTBEAT_INTERVAL_MS)

        // Poll loop
        const pollId = setInterval(async () => {
          if (aborted) {
            clearInterval(pollId)
            clearInterval(heartbeatId)
            return
          }
          const cont = await poll()
          if (!cont) {
            clearInterval(pollId)
            clearInterval(heartbeatId)
            if (!aborted) {
              aborted = true
              try { controller.close() } catch { /* already closed */ }
            }
          }
        }, POLL_INTERVAL_MS)

        // Clean up on abort
        req.signal.addEventListener("abort", () => {
          clearInterval(pollId)
          clearInterval(heartbeatId)
        })
      } else if (!aborted) {
        // Terminal state — close stream after sending initial data
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
