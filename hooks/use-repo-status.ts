"use client"

import { useEffect, useState } from "react"
import { useVisibility } from "./use-visibility"

const ACTIVE_STATUSES = ["indexing", "embedding", "justifying", "ontology", "pending"]
const POLL_INTERVAL_MS = 8_000

/**
 * Polls repo status while the pipeline is active.
 * Pauses automatically when the browser tab is hidden.
 * Prefer `useRepoEvents` (SSE) for active pipelines — this hook
 * serves as a fallback and for simpler use cases.
 */
export function useRepoStatus(repoId: string, initialStatus: string, initialProgress: number = 0) {
  const [status, setStatus] = useState(initialStatus)
  const [progress, setProgress] = useState(initialProgress)
  const [indexingStartedAt, setIndexingStartedAt] = useState<number | null>(null)
  const visible = useVisibility()

  // Sync when server passes new initialStatus (e.g. after navigation)
  useEffect(() => {
    setStatus(initialStatus)
    setProgress(initialProgress)
  }, [initialStatus, initialProgress])

  useEffect(() => {
    if (!ACTIVE_STATUSES.includes(status)) return
    // Pause polling when tab is hidden — no point burning requests
    if (!visible) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/status`)
        const body = (await res.json()) as {
          data?: {
            status?: string
            progress?: number
            indexingStartedAt?: number | null
          }
        }
        const data = body?.data
        if (data) {
          setStatus(data.status ?? status)
          setProgress(data.progress ?? 0)
          if (data.indexingStartedAt) setIndexingStartedAt(data.indexingStartedAt)
          if (!ACTIVE_STATUSES.includes(data.status ?? "")) clearInterval(interval)
        }
      } catch {
        clearInterval(interval)
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [repoId, status, visible])

  return { status, progress, setStatus, indexingStartedAt }
}
