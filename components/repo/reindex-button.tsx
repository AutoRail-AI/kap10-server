"use client"

import { RefreshCw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export function ReindexButton({ repoId }: { repoId: string }) {
  const [reindexing, setReindexing] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)
  const [triggered, setTriggered] = useState(false)

  const handleReindex = async () => {
    if (reindexing || rateLimited) return
    setReindexing(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/reindex`, {
        method: "POST",
      })
      if (res.status === 429) {
        setRateLimited(true)
        setTimeout(() => setRateLimited(false), 60_000)
        toast.error("Rate limited — max 1 re-index per hour. Try again later.")
        return
      }
      if (res.status === 409) {
        toast.warning("Indexing already in progress. Wait for it to complete.")
        return
      }
      if (res.ok) {
        setTriggered(true)
        toast.success("Re-indexing started")
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(body.error ?? `Re-index failed (${res.status})`)
      }
    } catch {
      toast.error("Network error — could not reach the server.")
    } finally {
      setReindexing(false)
    }
  }

  if (triggered) {
    return (
      <p className="text-xs text-emerald-400">
        Re-indexing started. Refresh the page to see progress.
      </p>
    )
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleReindex}
      disabled={reindexing || rateLimited}
      className="gap-1.5"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${reindexing ? "animate-spin" : ""}`} />
      {rateLimited ? "Rate limited" : reindexing ? "Starting..." : "Re-index"}
    </Button>
  )
}
