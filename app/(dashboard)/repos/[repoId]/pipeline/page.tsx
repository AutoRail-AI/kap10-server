"use client"

import { ChevronDown, Play, RefreshCw, Square } from "lucide-react"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { PipelineHistoryTable } from "@/components/repo/pipeline-history-table"
import { PipelineLogViewer } from "@/components/repo/pipeline-log-viewer"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

const ACTIVE_STATUSES = ["indexing", "embedding", "justifying", "ontology", "pending"]
const FAILED_STATUSES = ["error", "embed_failed", "justify_failed"]

export default function PipelinePage() {
  const pathname = usePathname()
  const repoId = pathname.match(/\/repos\/([^/]+)/)?.[1] ?? ""

  const [events, setEvents] = useState<IndexEvent[]>([])
  const [runs, setRuns] = useState<Array<{
    id: string; status: string; triggerType: string; pipelineType: string
    startedAt: string; completedAt: string | null; durationMs: number | null
    errorMessage: string | null; fileCount: number | null; functionCount: number | null
    entitiesWritten: number | null; edgesWritten: number | null
  }>>([])
  const [loading, setLoading] = useState(true)
  const [reindexing, setReindexing] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [repoStatus, setRepoStatus] = useState<string>("ready")
  const [rateLimited, setRateLimited] = useState(false)

  const isProcessing = ACTIVE_STATUSES.includes(repoStatus)
  const isFailed = FAILED_STATUSES.includes(repoStatus)

  // SSE connection — replaces the separate 5s status polling loop
  const { status: sseStatus } = useRepoEvents(repoId, { enabled: isProcessing })

  // Sync SSE status updates into local state
  useEffect(() => {
    if (sseStatus) {
      setRepoStatus(sseStatus.status)
    }
  }, [sseStatus])

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/repos/${repoId}/history/indexing`)
      if (res.ok) {
        const json = (await res.json()) as {
          data: { events: IndexEvent[]; runs?: typeof runs }
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

  // Fetch initial status + events
  useEffect(() => {
    if (!repoId) return

    void fetchEvents()

    // One-time status fetch on mount
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
  }, [repoId, fetchEvents])

  // Refresh event history when pipeline transitions to terminal state
  useEffect(() => {
    if (!isProcessing && !loading) {
      fetchEvents()
    }
  }, [isProcessing])

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
        setRepoStatus("indexing")
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

  const handleStop = async () => {
    try {
      const res = await fetch(`/api/repos/${repoId}/stop`, { method: "POST" })
      if (res.ok) {
        setRepoStatus("error")
      }
    } catch {
      // Fail silently
    }
  }

  const handleRestart = async () => {
    if (restarting || rateLimited) return
    setRestarting(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/retry`, { method: "POST" })
      if (res.status === 429) {
        setRateLimited(true)
        setTimeout(() => setRateLimited(false), 60_000)
        toast.error("Rate limited — max 3 retries per hour. Try again later.")
        return
      }
      if (res.ok) {
        setRepoStatus("indexing")
        toast.success("Pipeline retry started")
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(body.error ?? `Retry failed (${res.status})`)
      }
    } catch {
      toast.error("Network error — could not reach the server.")
    } finally {
      setRestarting(false)
    }
  }

  const handleResume = async (phase: string) => {
    if (resuming || rateLimited) return
    setResuming(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase }),
      })
      if (res.status === 429) {
        setRateLimited(true)
        setTimeout(() => setRateLimited(false), 60_000)
        toast.error("Rate limited — max 3 resumes per hour. Try again later.")
        return
      }
      if (res.ok) {
        const json = (await res.json()) as { data: { status: string } }
        setRepoStatus(json.data.status)
        toast.success(`Pipeline resumed from ${phase.replace("_", " ")}`)
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(body.error ?? `Resume failed (${res.status})`)
      }
    } catch {
      toast.error("Network error — could not reach the server.")
    } finally {
      setResuming(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="font-grotesk text-sm font-semibold text-foreground">
            Pipeline
          </h2>
          <p className="text-xs text-white/40">
            Manage indexing, view run history, and monitor pipeline logs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isProcessing && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={handleStop}
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          )}
          <Button
            size="sm"
            className="bg-rail-fade hover:opacity-90 gap-1.5 h-7 text-xs"
            onClick={handleReindex}
            disabled={reindexing || isProcessing || rateLimited}
          >
            {reindexing ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {rateLimited ? "Rate limited" : isProcessing ? "Processing…" : "Re-index"}
          </Button>
        </div>
      </div>

      {/* Current Status */}
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

      {/* Failed state — show Restart dropdown */}
      {isFailed && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center justify-between">
          <p className="text-sm font-medium text-destructive">
            Pipeline stopped or failed. Restart the full pipeline or resume from a specific phase.
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-1.5 h-7 text-xs"
                disabled={restarting || resuming || rateLimited}
              >
                {restarting || resuming ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {rateLimited ? "Wait 1m" : "Restart"}
                <ChevronDown className="h-3 w-3 ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={handleRestart}>
                Full Pipeline
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleResume("embedding")}>
                Embedding
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleResume("ontology")}>
                Ontology
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleResume("justification")}>
                Justification
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleResume("health_report")}>
                Health Report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Indexing History */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
          Run History
        </p>
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : (
          <PipelineHistoryTable events={events} runs={runs} />
        )}
      </div>

      {/* Live / Archived Logs */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
          Pipeline Logs
        </p>
        <PipelineLogViewer repoId={repoId} status={repoStatus} />
      </div>
    </div>
  )
}
