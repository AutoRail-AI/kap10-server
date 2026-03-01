"use client"

import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileCode,
  Layers,
  RefreshCw,
  XCircle,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { PipelineLogViewer } from "@/components/repo/pipeline-log-viewer"
import { PipelineStepper } from "@/components/repo/pipeline-stepper"
import { WhatsHappeningPanel } from "@/components/repo/whats-happening-panel"
import { Badge } from "@/components/ui/badge"
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
import { usePipelineLogs } from "@/hooks/use-pipeline-logs"
import type { PipelineStepRecord } from "@/lib/ports/types"

interface RunDetail {
  id: string
  repoId: string
  organizationId: string
  workflowId: string | null
  temporalRunId: string | null
  status: string
  triggerType: string
  triggerUserId: string | null
  pipelineType: string
  indexVersion: string | null
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  errorMessage: string | null
  steps: PipelineStepRecord[]
  fileCount: number | null
  functionCount: number | null
  classCount: number | null
  entitiesWritten: number | null
  edgesWritten: number | null
}

const statusConfig: Record<
  string,
  { icon: typeof CheckCircle2; className: string; label: string }
> = {
  running: {
    icon: Clock,
    className: "text-electric-cyan",
    label: "Running",
  },
  completed: {
    icon: CheckCircle2,
    className: "text-emerald-400",
    label: "Completed",
  },
  failed: { icon: XCircle, className: "text-destructive", label: "Failed" },
  cancelled: { icon: XCircle, className: "text-warning", label: "Cancelled" },
}

const ACTIVE_RUN_STATUSES = ["running"]
const FAILED_RUN_STATUSES = ["failed"]

/** Map run status to a repo-like status for PipelineStepper */
function runStatusToRepoStatus(run: RunDetail): string {
  if (run.status === "completed") return "ready"
  if (run.status === "failed") {
    // Derive failed phase from steps
    const failedStep = run.steps.find((s) => s.status === "failed")
    if (failedStep) {
      if (failedStep.name === "embed") return "embed_failed"
      if (["graphSync", "patternDetection"].includes(failedStep.name))
        return "justify_failed"
    }
    return "error"
  }
  if (run.status === "running") {
    const runningStep = run.steps.find((s) => s.status === "running")
    if (runningStep) {
      if (runningStep.name === "embed") return "embedding"
      if (["graphSync", "patternDetection"].includes(runningStep.name))
        return "justifying"
      if (["clone"].includes(runningStep.name)) return "indexing"
    }
    return "indexing"
  }
  return "pending"
}

/** Derive progress from steps */
function deriveProgress(steps: PipelineStepRecord[]): number {
  if (steps.length === 0) return 0
  const completed = steps.filter(
    (s) => s.status === "completed" || s.status === "skipped",
  ).length
  return Math.round((completed / steps.length) * 100)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export default function RunDetailPage() {
  const pathname = usePathname()
  const match = pathname.match(/\/repos\/([^/]+)\/activity\/([^/]+)/)
  const repoId = match?.[1] ?? ""
  const runId = match?.[2] ?? ""

  const [run, setRun] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)

  const isRunning = run ? ACTIVE_RUN_STATUSES.includes(run.status) : false
  const isFailed = run ? FAILED_RUN_STATUSES.includes(run.status) : false
  const repoStatus = run ? runStatusToRepoStatus(run) : "pending"
  const progress = run ? deriveProgress(run.steps) : 0
  const indexingStartedAt = run ? new Date(run.startedAt).getTime() : null

  // Logs for the WhatsHappeningPanel
  const { logs } = usePipelineLogs(repoId, isRunning || isFailed || run?.status === "completed", runId)

  const fetchRun = useCallback(async () => {
    try {
      const res = await fetch(`/api/repos/${repoId}/runs/${runId}`)
      if (!res.ok) {
        setError("Run not found")
        return
      }
      const json = (await res.json()) as { data?: { run?: RunDetail } }
      setRun(json.data?.run ?? null)
    } catch {
      setError("Failed to load run details")
    } finally {
      setLoading(false)
    }
  }, [repoId, runId])

  // Initial fetch
  useEffect(() => {
    if (!repoId || !runId) return
    void fetchRun()
  }, [repoId, runId, fetchRun])

  // Poll for updates while running
  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => void fetchRun(), 5_000)
    return () => clearInterval(interval)
  }, [isRunning, fetchRun])

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
        toast.success("Pipeline retry started")
        void fetchRun()
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
        toast.success(`Pipeline resumed from ${phase.replace("_", " ")}`)
        void fetchRun()
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

  if (loading) {
    return (
      <div className="space-y-6 py-6 animate-fade-in">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[100px] w-full" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="space-y-6 py-6 animate-fade-in">
        <Link
          href={`/repos/${repoId}/activity`}
          className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Activity
        </Link>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <XCircle className="mx-auto h-8 w-8 text-destructive/40 mb-3" />
          <p className="text-sm font-medium text-destructive">
            {error ?? "Run not found"}
          </p>
        </div>
      </div>
    )
  }

  const cfg = statusConfig[run.status] ?? statusConfig.running!
  const StatusIcon = cfg.icon

  return (
    <div className="space-y-4 py-6 animate-fade-in">
      {/* Back link + header */}
      <div className="space-y-3">
        <Link
          href={`/repos/${repoId}/activity`}
          className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Activity
        </Link>
        <div className="flex items-center gap-3">
          <StatusIcon className={`h-5 w-5 ${cfg.className}`} />
          <div>
            <h1 className="font-grotesk text-lg font-semibold text-foreground">
              Pipeline Run
            </h1>
            <p className="font-mono text-xs text-white/30">{run.id}</p>
          </div>
          <Badge
            variant="outline"
            className={`ml-auto text-xs ${cfg.className}`}
          >
            {cfg.label}
          </Badge>
        </div>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetaCard label="Trigger" value={run.triggerType} />
        <MetaCard label="Type" value={run.pipelineType} />
        <MetaCard label="Started" value={formatTimestamp(run.startedAt)} mono />
        <MetaCard
          label="Duration"
          value={run.durationMs != null ? formatDuration(run.durationMs) : "..."}
          mono
        />
      </div>

      {/* Pipeline Stepper — workflow tracker */}
      <PipelineStepper
        status={repoStatus}
        progress={progress}
        steps={run.steps}
      />

      {/* Error state with restart dropdown */}
      {isFailed && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">Pipeline Error</p>
            <p className="text-xs text-muted-foreground">
              {run.errorMessage ?? "The pipeline encountered an error."}
            </p>
          </div>
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

      {/* Console + Analytics grid (matches onboarding console layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <PipelineLogViewer
            repoId={repoId}
            status={run.status === "running" ? repoStatus : run.status}
            runId={runId}
          />
        </div>
        <div className="lg:col-span-1">
          <WhatsHappeningPanel
            status={repoStatus}
            progress={progress}
            logs={logs}
            indexingStartedAt={indexingStartedAt}
          />
        </div>
      </div>

      {/* Results metrics */}
      {(run.fileCount != null || run.entitiesWritten != null) && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
            Results
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard
              icon={FileCode}
              label="Files"
              value={run.fileCount}
            />
            <StatCard
              icon={Layers}
              label="Functions"
              value={run.functionCount}
            />
            <StatCard
              icon={Layers}
              label="Classes"
              value={run.classCount}
            />
            <StatCard
              icon={Layers}
              label="Entities Written"
              value={run.entitiesWritten}
            />
            <StatCard
              icon={RefreshCw}
              label="Edges Written"
              value={run.edgesWritten}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function MetaCard({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/2 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 mb-1">
        {label}
      </p>
      <p
        className={`text-sm text-foreground ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </p>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileCode
  label: string
  value: number | null
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/2 p-3 flex items-center gap-2.5">
      <Icon className="h-3.5 w-3.5 text-white/20 shrink-0" />
      <div>
        <p className="font-mono text-sm font-semibold text-foreground tabular-nums">
          {value?.toLocaleString() ?? "\u2014"}
        </p>
        <p className="text-[10px] text-white/30">{label}</p>
      </div>
    </div>
  )
}
