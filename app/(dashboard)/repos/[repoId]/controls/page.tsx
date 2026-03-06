"use client"

import {
  ChevronDown,
  CircleDot,
  HeartPulse,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
} from "lucide-react"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { useRepoEvents } from "@/hooks/use-repo-events"

const ACTIVE_STATUSES = [
  "indexing",
  "embedding",
  "justifying",
  "ontology",
  "pending",
]
const FAILED_STATUSES = ["error", "embed_failed", "justify_failed"]

const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  ready: { label: "Idle", color: "bg-emerald-400" },
  indexing: { label: "Indexing", color: "bg-electric-cyan" },
  embedding: { label: "Embedding", color: "bg-primary" },
  justifying: { label: "Justifying", color: "bg-primary" },
  ontology: { label: "Ontology", color: "bg-primary" },
  pending: { label: "Pending", color: "bg-amber-400" },
  error: { label: "Failed", color: "bg-red-400" },
  embed_failed: { label: "Embedding Failed", color: "bg-red-400" },
  justify_failed: { label: "Justification Failed", color: "bg-red-400" },
}

export default function ControlsPage() {
  const pathname = usePathname()
  const repoId = pathname.match(/\/repos\/([^/]+)/)?.[1] ?? ""

  const [repoStatus, setRepoStatus] = useState<string>("ready")
  const [reindexing, setReindexing] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)
  const [retryRateLimited, setRetryRateLimited] = useState(false)

  const isProcessing = ACTIVE_STATUSES.includes(repoStatus)
  const isFailed = FAILED_STATUSES.includes(repoStatus)

  const { status: sseStatus } = useRepoEvents(repoId, {
    enabled: isProcessing,
  })

  useEffect(() => {
    if (sseStatus) setRepoStatus(sseStatus.status)
  }, [sseStatus])

  // Fetch initial status
  useEffect(() => {
    if (!repoId) return
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
  }, [repoId])

  const handleReindex = useCallback(async () => {
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
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        toast.error(body.error ?? `Re-index failed (${res.status})`)
      }
    } catch {
      toast.error("Network error — could not reach the server.")
    } finally {
      setReindexing(false)
    }
  }, [repoId, reindexing, rateLimited])

  const handleRegenerateHealth = useCallback(async () => {
    if (regenerating || isProcessing) return
    setRegenerating(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/health/regenerate`, {
        method: "POST",
      })
      if (res.ok) {
        toast.success("Health report regeneration started")
        setRepoStatus("justifying")
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        toast.error(body.error ?? `Regeneration failed (${res.status})`)
      }
    } catch {
      toast.error("Network error — could not reach the server.")
    } finally {
      setRegenerating(false)
    }
  }, [repoId, regenerating, isProcessing])

  const handleStop = useCallback(async () => {
    if (stopping) return
    setStopping(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/stop`, { method: "POST" })
      if (res.ok) {
        setRepoStatus("error")
        toast.success("Pipeline stopped")
      } else {
        toast.error("Failed to stop pipeline")
      }
    } catch {
      toast.error("Network error — could not reach the server.")
    } finally {
      setStopping(false)
    }
  }, [repoId, stopping])

  const handleRestart = useCallback(async () => {
    if (restarting || retryRateLimited) return
    setRestarting(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/retry`, { method: "POST" })
      if (res.status === 429) {
        setRetryRateLimited(true)
        setTimeout(() => setRetryRateLimited(false), 60_000)
        toast.error("Rate limited — max 3 retries per hour. Try again later.")
        return
      }
      if (res.ok) {
        setRepoStatus("indexing")
        toast.success("Pipeline retry started")
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        toast.error(body.error ?? `Retry failed (${res.status})`)
      }
    } catch {
      toast.error("Network error — could not reach the server.")
    } finally {
      setRestarting(false)
    }
  }, [repoId, restarting, retryRateLimited])

  const handleResume = useCallback(
    async (phase: string) => {
      if (resuming || retryRateLimited) return
      setResuming(true)
      try {
        const res = await fetch(`/api/repos/${repoId}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase }),
        })
        if (res.status === 429) {
          setRetryRateLimited(true)
          setTimeout(() => setRetryRateLimited(false), 60_000)
          toast.error(
            "Rate limited — max 3 resumes per hour. Try again later."
          )
          return
        }
        if (res.ok) {
          const json = (await res.json()) as { data: { status: string } }
          setRepoStatus(json.data.status)
          toast.success(`Pipeline resumed from ${phase.replace("_", " ")}`)
        } else {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          toast.error(body.error ?? `Resume failed (${res.status})`)
        }
      } catch {
        toast.error("Network error — could not reach the server.")
      } finally {
        setResuming(false)
      }
    },
    [repoId, resuming, retryRateLimited]
  )

  const statusInfo = STATUS_DISPLAY[repoStatus] ?? {
    label: repoStatus,
    color: "bg-white/40",
  }

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">
          Controls
        </h1>
        <p className="text-sm text-foreground mt-0.5">
          Pipeline operations and management.
        </p>
      </div>

      {/* Pipeline Status Banner */}
      <div
        className={`rounded-lg border p-4 flex items-center gap-3 ${
          isProcessing
            ? "border-primary/30 bg-primary/5 animate-breathing-glow"
            : isFailed
              ? "border-red-500/30 bg-red-500/5"
              : "border-emerald-500/20 bg-emerald-500/5"
        }`}
      >
        {isProcessing ? (
          <Spinner className="h-4 w-4 text-primary" />
        ) : (
          <CircleDot
            className={`h-4 w-4 ${isFailed ? "text-red-400" : "text-emerald-400"}`}
          />
        )}
        <div>
          <p className="text-sm font-medium text-foreground">
            {isProcessing
              ? `Pipeline running: ${statusInfo.label}`
              : isFailed
                ? `Pipeline failed: ${statusInfo.label}`
                : "Pipeline idle"}
          </p>
          <p className="text-xs text-white/40 mt-0.5">
            {isProcessing
              ? "The dashboard remains fully functional during processing."
              : isFailed
                ? "Use the controls below to retry or resume the pipeline."
                : "All systems operational. Run a re-index or regenerate the health report below."}
          </p>
        </div>
      </div>

      {/* Operations Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Re-index */}
        <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-primary/10 p-1.5">
              <Play className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Re-index</p>
              <p className="text-[10px] text-white/40">
                Full pipeline re-run
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Re-scan the repository, rebuild the knowledge graph, and regenerate
            all derived data.
          </p>
          <Button
            size="sm"
            className="w-full bg-rail-fade hover:opacity-90 gap-1.5"
            onClick={handleReindex}
            disabled={reindexing || isProcessing || rateLimited}
          >
            {reindexing ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {rateLimited
              ? "Rate limited (1/hr)"
              : isProcessing
                ? "Processing..."
                : "Start Re-index"}
          </Button>
        </div>

        {/* Regenerate Health */}
        <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-emerald-500/10 p-1.5">
              <HeartPulse className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Regenerate Health
              </p>
              <p className="text-[10px] text-white/40">Health report only</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Re-run the health analysis without re-indexing. Uses existing graph
            data to produce a fresh report.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5"
            onClick={handleRegenerateHealth}
            disabled={regenerating || isProcessing}
          >
            {regenerating ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <HeartPulse className="h-3 w-3" />
            )}
            {regenerating ? "Regenerating..." : "Regenerate"}
          </Button>
        </div>

        {/* Stop Pipeline — only when processing */}
        {isProcessing && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-red-500/10 p-1.5">
                <Square className="h-3.5 w-3.5 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Stop Pipeline
                </p>
                <p className="text-[10px] text-white/40">Cancel in progress</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Immediately cancel the running pipeline. Partial results will be
              preserved.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={handleStop}
              disabled={stopping}
            >
              {stopping ? (
                <Spinner className="h-3 w-3" />
              ) : (
                <Square className="h-3 w-3" />
              )}
              {stopping ? "Stopping..." : "Stop Pipeline"}
            </Button>
          </div>
        )}

        {/* Retry Pipeline — only when failed */}
        {isFailed && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-amber-500/10 p-1.5">
                <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Retry Pipeline
                </p>
                <p className="text-[10px] text-white/40">
                  Full restart from scratch
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Restart the entire pipeline from the beginning. Use this when a
              transient error caused the failure.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              onClick={handleRestart}
              disabled={restarting || retryRateLimited}
            >
              {restarting ? (
                <Spinner className="h-3 w-3" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {retryRateLimited ? "Rate limited (3/hr)" : "Retry Full Pipeline"}
            </Button>
          </div>
        )}

        {/* Resume from Phase — only when failed */}
        {isFailed && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-amber-500/10 p-1.5">
                <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Resume from Phase
                </p>
                <p className="text-[10px] text-white/40">
                  Pick up where it failed
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Resume the pipeline from a specific phase. Useful when indexing
              succeeded but a later phase failed.
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  disabled={resuming || retryRateLimited}
                >
                  {resuming ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  {retryRateLimited ? "Rate limited (3/hr)" : "Resume from..."}
                  <ChevronDown className="h-3 w-3 ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => handleResume("embedding")}>
                  Embedding
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleResume("ontology")}>
                  Ontology
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleResume("justification")}
                >
                  Justification
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleResume("health_report")}
                >
                  Health Report
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}
