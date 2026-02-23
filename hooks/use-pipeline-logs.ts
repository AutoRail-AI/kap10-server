"use client"

import { useCallback, useEffect, useRef, useState } from "react"

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

export function usePipelineLogs(
  repoId: string,
  enabled: boolean
): UsePipelineLogsResult {
  const [logs, setLogs] = useState<PipelineLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<"live" | "archived" | "none">("none")
  const stoppedRef = useRef(false)

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/repos/${repoId}/logs`)
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
  }, [repoId])

  useEffect(() => {
    if (!enabled) return
    stoppedRef.current = false
    setLoading(true)
    fetchLogs()

    const interval = setInterval(() => {
      if (stoppedRef.current) {
        clearInterval(interval)
        return
      }
      fetchLogs()
    }, 4000)

    return () => clearInterval(interval)
  }, [repoId, enabled, fetchLogs])

  return { logs, loading, source }
}
