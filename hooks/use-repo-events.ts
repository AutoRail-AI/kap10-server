"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useVisibility } from "./use-visibility"

/**
 * SSE-backed hook for real-time repo pipeline events.
 *
 * Connects to `/api/repos/{repoId}/events` via EventSource when the pipeline
 * is active. Replaces separate polling loops for status + logs with a single
 * server-pushed stream. Falls back gracefully — if SSE fails, callers can
 * still use the traditional polling hooks.
 *
 * The connection is automatically paused when the tab is hidden and resumed
 * when the user returns.
 */

export interface RepoStatusEvent {
  status: string
  progress: number
  indexingStartedAt: number | null
  errorMessage: string | null
  fileCount?: number
  functionCount?: number
  classCount?: number
}

export interface PipelineLogEntry {
  timestamp: string
  level: "info" | "warn" | "error"
  phase: string
  step: string
  message: string
  meta?: Record<string, unknown>
}

export interface RepoLogsEvent {
  source: "live" | "archived" | "none"
  logs: PipelineLogEntry[]
  count: number
}

interface UseRepoEventsOptions {
  /** Only connect when true (e.g., pipeline is active) */
  enabled: boolean
}

interface UseRepoEventsResult {
  status: RepoStatusEvent | null
  logs: RepoLogsEvent | null
  connected: boolean
}

export function useRepoEvents(
  repoId: string,
  { enabled }: UseRepoEventsOptions
): UseRepoEventsResult {
  const visible = useVisibility()
  const [status, setStatus] = useState<RepoStatusEvent | null>(null)
  const [logs, setLogs] = useState<RepoLogsEvent | null>(null)
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const cleanup = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    // Don't connect if disabled or tab hidden
    if (!enabled || !visible || !repoId) {
      cleanup()
      return
    }

    // Already connected
    if (esRef.current) return

    const es = new EventSource(`/api/repos/${repoId}/events`)
    esRef.current = es

    es.addEventListener("status", (e) => {
      try {
        const data = JSON.parse(e.data) as RepoStatusEvent
        setStatus(data)
      } catch { /* malformed event */ }
    })

    es.addEventListener("logs", (e) => {
      try {
        const data = JSON.parse(e.data) as RepoLogsEvent
        setLogs(data)
      } catch { /* malformed event */ }
    })

    es.onopen = () => setConnected(true)

    es.onerror = () => {
      // EventSource auto-reconnects by default.
      // If we get repeated errors, the browser backs off automatically.
      setConnected(false)
    }

    return cleanup
  }, [repoId, enabled, visible, cleanup])

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup])

  return { status, logs, connected }
}
