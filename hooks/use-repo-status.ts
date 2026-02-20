"use client"

import { useEffect, useState } from "react"

export function useRepoStatus(repoId: string, initialStatus: string, initialProgress: number = 0) {
  const [status, setStatus] = useState(initialStatus)
  const [progress, setProgress] = useState(initialProgress)

  useEffect(() => {
    if (status !== "indexing") return
    setProgress((prev) => (prev === 0 ? 0 : prev))
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/status`)
        const body = (await res.json()) as { data?: { status?: string; progress?: number } }
        const data = body?.data
        if (data) {
          setStatus(data.status ?? status)
          setProgress(data.progress ?? 0)
          if (data.status !== "indexing") clearInterval(interval)
        }
      } catch {
        clearInterval(interval)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [repoId, status])

  return { status, progress, setStatus }
}
