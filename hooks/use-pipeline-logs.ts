"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useVisibility } from "./use-visibility"

export interface PipelineLogEntry {
  timestamp: string
  level: "info" | "warn" | "error"
  phase: string
  step: string
  message: string
  meta?: Record<string, unknown>
}

interface UsePipelineLogsResult {
  logs: PipelineLogEntry[]
  loading: boolean
  source: "live" | "archived" | "none"
}

const POLL_INTERVAL_MS = 4_000

/**
 * Polls pipeline logs while enabled.
 * Pauses automatically when the browser tab is hidden.
 * Prefer `useRepoEvents` (SSE) for active pipelines — this hook
 * serves as a fallback for archived/terminal-state logs.
 */
export function usePipelineLogs(
  repoId: string,
  enabled: boolean,
  runId?: string | null
): UsePipelineLogsResult {
  const [logs, setLogs] = useState<PipelineLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<"live" | "archived" | "none">("none")
  const stoppedRef = useRef(false)
  const visible = useVisibility()

  const fetchLogs = useCallback(async () => {
    try {
      const url = runId
        ? `/api/repos/${repoId}/logs?runId=${runId}`
        : `/api/repos/${repoId}/logs`
      const res = await fetch(url)
      if (!res.ok) return
      const body = (await res.json()) as {
        data?: { source?: string; logs?: PipelineLogEntry[] }
      }
      const data = body?.data
      if (!data) return

      setLogs(data.logs ?? [])
      setSource((data.source as "live" | "archived" | "none") ?? "none")
      setLoading(false)

      // Stop polling once archived or none
      if (data.source === "archived" || data.source === "none") {
        stoppedRef.current = true
      }
    } catch {
      setLoading(false)
    }
  }, [repoId, runId])

  useEffect(() => {
    if (!enabled) return
    // Pause when tab is hidden
    if (!visible) return

    stoppedRef.current = false
    setLoading(true)
    fetchLogs()

    const interval = setInterval(() => {
      if (stoppedRef.current) {
        clearInterval(interval)
        return
      }
      fetchLogs()
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [repoId, enabled, visible, fetchLogs])

  return { logs, loading, source }
}
