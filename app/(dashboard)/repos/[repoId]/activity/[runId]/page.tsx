"use client"

import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileCode,
  Layers,
  RefreshCw,
  XCircle,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { PipelineLogViewer } from "@/components/repo/pipeline-log-viewer"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

interface PipelineStep {
  name: string
  label: string
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  startedAt?: string
  completedAt?: string
  durationMs?: number
  errorMessage?: string
}

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
  steps: PipelineStep[]
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

const stepStatusColors: Record<string, string> = {
  pending: "border-white/10 bg-white/2 text-white/30",
  running: "border-electric-cyan/30 bg-electric-cyan/5 text-electric-cyan",
  completed: "border-emerald-400/30 bg-emerald-400/5 text-emerald-400",
  failed: "border-destructive/30 bg-destructive/5 text-destructive",
  skipped: "border-white/10 bg-white/2 text-white/20",
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

  useEffect(() => {
    if (!repoId || !runId) return
    void (async () => {
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
    })()
  }, [repoId, runId])

  if (loading) {
    return (
      <div className="space-y-6 py-6 animate-fade-in">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[200px] w-full" />
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
    <div className="space-y-6 py-6 animate-fade-in">
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

      {/* Error message */}
      {run.errorMessage && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-destructive/60 mb-1">
            Error
          </p>
          <p className="text-sm text-destructive font-mono whitespace-pre-wrap">
            {run.errorMessage}
          </p>
        </div>
      )}

      {/* Pipeline steps */}
      {run.steps && run.steps.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
            Pipeline Steps
          </p>
          <div className="space-y-1.5">
            {run.steps.map((step) => (
              <div
                key={step.name}
                className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 ${
                  stepStatusColors[step.status] ?? stepStatusColors.pending
                }`}
              >
                <span className="text-xs font-medium flex-1">
                  {step.label}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider opacity-60">
                  {step.status}
                </span>
                {step.durationMs != null && (
                  <span className="text-[10px] font-mono text-white/30 tabular-nums">
                    {formatDuration(step.durationMs)}
                  </span>
                )}
                {step.errorMessage && (
                  <span
                    className="text-[10px] text-destructive truncate max-w-[200px]"
                    title={step.errorMessage}
                  >
                    {step.errorMessage}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics */}
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

      {/* Logs for this run */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
          Logs
        </p>
        <PipelineLogViewer
          repoId={repoId}
          status={run.status}
          runId={runId}
        />
      </div>
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
