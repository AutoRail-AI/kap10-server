"use client"

import { Settings2 } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { ActivityFeed } from "@/components/activity/activity-feed"
import { PipelineHistoryTable } from "@/components/repo/pipeline-history-table"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useRepoEvents } from "@/hooks/use-repo-events"

interface IndexEvent {
  event_type: string
  files_changed: number
  entities_added: number
  entities_updated: number
  entities_deleted: number
  edges_repaired: number
  duration_ms: number
  push_sha: string
  commit_message: string
  cascade_status: string
  created_at: string
  workflow_id: string
}

interface PipelineRun {
  id: string
  status: string
  triggerType: string
  pipelineType: string
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  errorMessage: string | null
  fileCount: number | null
  functionCount: number | null
  entitiesWritten: number | null
  edgesWritten: number | null
}

const ACTIVE_STATUSES = ["indexing", "embedding", "justifying", "ontology", "pending"]
const FAILED_STATUSES = ["error", "embed_failed", "justify_failed"]

export default function ActivityPage() {
  const pathname = usePathname()
  const repoId = pathname.match(/\/repos\/([^/]+)/)?.[1] ?? ""

  const [events, setEvents] = useState<IndexEvent[]>([])
  const [runs, setRuns] = useState<PipelineRun[]>([])
  const [loading, setLoading] = useState(true)
  const [repoStatus, setRepoStatus] = useState<string>("ready")

  const isProcessing = ACTIVE_STATUSES.includes(repoStatus)

  const { status: sseStatus } = useRepoEvents(repoId, { enabled: isProcessing })

  useEffect(() => {
    if (sseStatus) setRepoStatus(sseStatus.status)
  }, [sseStatus])

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/repos/${repoId}/history/indexing`)
      if (res.ok) {
        const json = (await res.json()) as {
          data: { events: IndexEvent[]; runs?: PipelineRun[] }
        }
        setEvents(json.data.events)
        if (json.data.runs) setRuns(json.data.runs)
      }
    } catch {
      // Fail silently
    } finally {
      setLoading(false)
    }
  }, [repoId])

  useEffect(() => {
    if (!repoId) return
    void fetchData()
    void (async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/status`)
        if (res.ok) {
          const json = (await res.json()) as { data: { status: string } }
          setRepoStatus(json.data.status)
        }
      } catch {
        // Fail silently
      }
    })()
  }, [repoId, fetchData])

  // Refresh when pipeline finishes
  useEffect(() => {
    if (!isProcessing && !loading) {
      fetchData()
    }
  }, [isProcessing])

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="font-grotesk text-base font-semibold text-foreground">
            Pipeline
          </h2>
          <p className="text-sm text-muted-foreground">
            Indexing events and pipeline runs.
          </p>
        </div>
        <Link
          href={`/repos/${repoId}/controls`}
          className="flex items-center gap-1.5 text-xs text-electric-cyan hover:underline"
        >
          <Settings2 className="h-3 w-3" />
          Manage pipeline &rarr;
        </Link>
      </div>

      {/* Pipeline status banner (read-only) */}
      {isProcessing && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-center gap-3 animate-breathing-glow">
          <Spinner className="h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Pipeline running: {repoStatus}
            </p>
            <p className="text-xs text-white/40 mt-0.5">
              The dashboard remains fully functional during reindexing.
            </p>
          </div>
        </div>
      )}

      {/* Index Events section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
            Index Events
          </p>
          {events.length > 0 && (
            <span className="font-mono text-[10px] text-white/25 tabular-nums">
              {events.length}
            </span>
          )}
        </div>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : events.length > 0 ? (
          <PipelineHistoryTable events={events} runs={[]} />
        ) : (
          <ActivityFeed repoId={repoId} />
        )}
      </section>

      {/* Pipeline Runs section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
            Pipeline Runs
          </p>
          {runs.length > 0 && (
            <span className="font-mono text-[10px] text-white/25 tabular-nums">
              {runs.length}
            </span>
          )}
        </div>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : (
          <PipelineHistoryTable
            events={[]}
            runs={runs}
            repoId={repoId}
          />
        )}
      </section>
    </div>
  )
}
