"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { useVisibility } from "@/hooks/use-visibility"
import { IndexEventCard } from "./index-event-card"

interface IndexEvent {
  push_sha: string
  commit_message: string
  event_type: "incremental" | "full_reindex" | "force_push_reindex"
  files_changed: number
  entities_added: number
  entities_updated: number
  entities_deleted: number
  edges_repaired: number
  embeddings_updated: number
  cascade_status: string
  cascade_entities: number
  duration_ms: number
  extraction_errors?: Array<{ filePath: string; reason: string; quarantined: boolean }>
  created_at: string
}

interface ActivityData {
  events: IndexEvent[]
  inFlightStatus: { workflowId: string; status: string; progress?: number } | null
  repo: { id: string; name: string; status: string; lastIndexedAt: string | null; lastIndexedSha: string | null }
}

/** Active polling: 5s. Idle (no in-flight work): 30s. */
const ACTIVE_INTERVAL_MS = 5_000
const IDLE_INTERVAL_MS = 30_000

export function ActivityFeed({ repoId }: { repoId: string }) {
  const [data, setData] = useState<ActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  const visible = useVisibility()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch(`/api/repos/${repoId}/activity`)
      if (res.ok) {
        const json = (await res.json()) as { data: ActivityData }
        setData(json.data)
      }
    } catch {
      // Silently retry on next poll
    } finally {
      setLoading(false)
    }
  }, [repoId])

  useEffect(() => {
    // Pause when tab is hidden
    if (!visible) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Initial fetch
    fetchActivity()

    // Progressive interval: fast when pipeline active, slow when idle
    const interval = data?.inFlightStatus ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS
    intervalRef.current = setInterval(fetchActivity, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [fetchActivity, visible, data?.inFlightStatus !== null])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[120px] w-full" />
        <Skeleton className="h-[120px] w-full" />
        <Skeleton className="h-[120px] w-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">Failed to load activity data.</p>
    )
  }

  return (
    <div className="space-y-4">
      {data.inFlightStatus && (
        <div className="glass-card rounded-lg border border-primary/30 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Indexing in progress</span>
            <span className="text-xs text-primary animate-pulse">Running</span>
          </div>
          <Progress value={data.inFlightStatus.progress ?? 0} className="h-1.5" />
          <p className="text-xs text-muted-foreground">
            {data.inFlightStatus.progress ?? 0}% complete
          </p>
        </div>
      )}

      {data.events.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No indexing activity yet. Push changes to trigger incremental indexing.
        </p>
      ) : (
        data.events.map((event, idx) => (
          <IndexEventCard key={`${event.push_sha}-${idx}`} event={event} />
        ))
      )}
    </div>
  )
}
