"use client"

import { useEffect, useState } from "react"

export function useRepoStatus(repoId: string, initialStatus: string, initialProgress: number = 0) {
  const [status, setStatus] = useState(initialStatus)
  const [progress, setProgress] = useState(initialProgress)
  const [indexingStartedAt, setIndexingStartedAt] = useState<number | null>(null)

  useEffect(() => {
    const activeStatuses = ["indexing", "embedding", "justifying"]
    if (!activeStatuses.includes(status)) return

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
          if (!activeStatuses.includes(data.status ?? "")) clearInterval(interval)
        }
      } catch {
        clearInterval(interval)
      }
    }, 8000)
    return () => clearInterval(interval)
  }, [repoId, status])

  return { status, progress, setStatus, indexingStartedAt }
}
