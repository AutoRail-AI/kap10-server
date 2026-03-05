"use client"

import { Activity, AlertTriangle, Check, Clock, FileCode, GitFork, Layers, MessageSquare, Shield, Sparkles, Zap } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { PipelineLogEntry } from "@/hooks/use-pipeline-logs"
import type { PipelineStepRecord } from "@/lib/ports/types"

interface WhatsHappeningPanelProps {
  status: string
  progress: number
  logs: PipelineLogEntry[]
  steps?: PipelineStepRecord[]
  indexingStartedAt?: number | null
  errorMessage?: string | null
}

/** User-friendly labels for both repo status values and pipeline log phases. */
const PHASE_LABELS: Record<string, string> = {
  // Repo status values
  pending:          "Queued",
  ready:            "Complete",
  error:            "Error",
  embed_failed:     "Embed Failed",
  justify_failed:   "Justify Failed",
  // Pipeline log phases (must match PipelineLogEntry["phase"] union)
  indexing:            "Scanning & Parsing",
  embedding:           "Building Intelligence Graph",
  "graph-analysis":    "Graph Analysis",
  "temporal-analysis": "Mining Temporal Patterns",
  ontology:            "Ontology Discovery",
  justifying:          "Understanding Business Context",
  "graph-sync":        "Syncing Graph",
  "pattern-detection": "Detecting Patterns",
}

/** Maps status to a contextual description of what's happening right now. */
const STATUS_DESCRIPTIONS: Record<string, string> = {
  pending:         "Waiting in queue for a worker to pick up...",
  indexing:        "Cloning your repository and analyzing its structure with SCIP & tree-sitter.",
  embedding:       "Generating vector embeddings for semantic search across your codebase.",
  ontology:        "Discovering domain concepts, feature boundaries, and architectural layers.",
  justifying:      "Classifying every entity with business purpose, feature tags, and health signals.",
  ready:           "All analysis complete. Your codebase intelligence is ready.",
  error:           "The pipeline encountered an error. Check the logs for details.",
  embed_failed:    "Embedding generation failed. Indexing data is preserved — you can resume.",
  justify_failed:  "Justification failed. Embeddings and ontology are preserved — you can resume.",
}

interface PhaseTiming {
  phase: string
  label: string
  startedAt: number
  completedAt: number | null
  durationMs: number | null
}

function derivePhaseTimings(logs: PipelineLogEntry[]): PhaseTiming[] {
  const timings: PhaseTiming[] = []
  const phaseStartMap = new Map<string, number>()

  for (const entry of logs) {
    const ts = new Date(entry.timestamp).getTime()
    const phase = entry.phase

    if (!phaseStartMap.has(phase)) {
      phaseStartMap.set(phase, ts)
      timings.push({
        phase,
        label: PHASE_LABELS[phase] ?? phase,
        startedAt: ts,
        completedAt: null,
        durationMs: null,
      })
    }
  }

  // Mark completed: a phase is complete when the next phase starts
  for (let i = 0; i < timings.length - 1; i++) {
    const current = timings[i]!
    const next = timings[i + 1]!
    current.completedAt = next.startedAt
    current.durationMs = next.startedAt - current.startedAt
  }

  return timings
}

function getPipelineStartTime(logs: PipelineLogEntry[]): number | null {
  if (logs.length === 0) return null
  return new Date(logs[0]!.timestamp).getTime()
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

/** Extract a named metric from log messages or metadata, searching newest first. */
function extractMetric(logs: PipelineLogEntry[], patterns: RegExp[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]
    if (!entry) continue
    const text = entry.message
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match?.[1]) return match[1]
    }
    if (entry.meta) {
      for (const key of Object.keys(entry.meta)) {
        for (const pattern of patterns) {
          const keyMatch = key.match(pattern)
          if (keyMatch) {
            return String(entry.meta[key])
          }
        }
      }
    }
  }
  return null
}

/** Extract a numeric value from the most recent log meta. */
function extractMetaValue(logs: PipelineLogEntry[], key: string): number | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]
    if (!entry?.meta) continue
    const val = entry.meta[key]
    if (typeof val === "number") return val
  }
  return null
}

/** Get the most recent log message for display. */
function getLastLogMessage(logs: PipelineLogEntry[]): { message: string; level: string; phase: string } | null {
  if (logs.length === 0) return null
  const last = logs[logs.length - 1]!
  return { message: last.message, level: last.level, phase: last.phase }
}

// ── Stat Row Component ────────────────────────────────────────────────────────

function StatRow({ icon, label, value, accent }: {
  icon: React.ReactNode
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className={`text-xs font-medium font-mono tabular-nums ${accent ? "text-electric-cyan" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function WhatsHappeningPanel({ status, progress, logs, steps, indexingStartedAt, errorMessage }: WhatsHappeningPanelProps) {
  const [now, setNow] = useState(Date.now())

  const isActive = !["ready", "error", "embed_failed", "justify_failed"].includes(status)
  const isEndState = !isActive
  const isError = ["error", "embed_failed", "justify_failed"].includes(status)

  // Use server-persisted timestamp first, fall back to first log entry
  const pipelineStartTime = useMemo(
    () => indexingStartedAt ?? getPipelineStartTime(logs),
    [indexingStartedAt, logs],
  )
  const phaseTimings = useMemo(() => derivePhaseTimings(logs), [logs])

  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [isActive])

  const totalElapsed = pipelineStartTime
    ? (isEndState ? (phaseTimings[phaseTimings.length - 1]?.completedAt ?? now) : now) - pipelineStartTime
    : 0

  const currentPhase = phaseTimings[phaseTimings.length - 1]
  const currentPhaseDuration = currentPhase && !currentPhase.completedAt
    ? now - currentPhase.startedAt
    : null

  // ── Metrics from logs ───────────────────────────────────────────────────────

  const filesProcessed = extractMetric(logs, [
    /(\d+)\s*files?\s*(processed|indexed|scanned|found)/i,
    /scanned\s*(\d+)\s*files?/i,
    /indexing\s*(\d+)\s*files?/i,
  ])

  const entitiesFound = extractMetric(logs, [
    /(\d+)\s*entit(y|ies)/i,
    /found\s*(\d+)\s*(functions?|classes?|symbols?)/i,
    /(\d+)\s*(functions?|classes?|symbols?)\s*found/i,
  ])

  const edgesCreated = extractMetric(logs, [
    /(\d+)\s*edges?/i,
    /(\d+)\s*relationships?/i,
  ])

  // Quality metrics from completion logs
  const scipCoverage = extractMetaValue(logs, "scipCoveragePercent")
  const highRiskNodes = extractMetaValue(logs, "highRiskCount")
  const coChangeEdges = extractMetaValue(logs, "coChangeEdges")
  const embeddingsStored = extractMetaValue(logs, "embeddingsStored")

  // Last log for live activity feed
  const lastLog = useMemo(() => getLastLogMessage(logs), [logs])

  // Step-level stats from pipeline run data
  const stepStats = useMemo(() => {
    if (!steps || steps.length === 0) return null
    const completed = steps.filter((s) => s.status === "completed" || s.status === "skipped").length
    const failed = steps.filter((s) => s.status === "failed").length
    const running = steps.filter((s) => s.status === "running").length
    const currentStep = steps.find((s) => s.status === "running")
    return { completed, failed, running, total: steps.length, currentStep }
  }, [steps])

  return (
    <div className="glass-card border-border rounded-lg border p-4 space-y-4">
      <h3 className="font-grotesk text-xs font-semibold text-foreground uppercase tracking-wider">
        What&apos;s Happening
      </h3>

      {/* Current Activity Description */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {isError ? (
            <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
          ) : isActive ? (
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-electric-cyan/40" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-electric-cyan/70" />
            </span>
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          )}
          <span className={`text-xs font-medium ${isError ? "text-destructive" : isActive ? "text-electric-cyan" : "text-emerald-400"}`}>
            {PHASE_LABELS[status] ?? status}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed pl-5">
          {STATUS_DESCRIPTIONS[status] ?? "Processing..."}
        </p>
      </div>

      {/* Current Step Indicator (from pipeline run data) */}
      {stepStats?.currentStep && isActive && (
        <div className="rounded-md bg-electric-cyan/5 border border-electric-cyan/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <Zap className="h-3 w-3 text-electric-cyan shrink-0" />
            <span className="text-[11px] text-electric-cyan font-medium">
              {stepStats.currentStep.label}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto font-mono tabular-nums">
              {stepStats.completed}/{stepStats.total} steps
            </span>
          </div>
        </div>
      )}

      {/* Error Detail */}
      {isError && errorMessage && (
        <div className="rounded-md bg-destructive/5 border border-destructive/10 px-3 py-2">
          <p className="text-[11px] text-destructive/80 leading-relaxed">
            {errorMessage.length > 200 ? errorMessage.slice(0, 200) + "…" : errorMessage}
          </p>
        </div>
      )}

      {/* Stats Grid */}
      <div className="space-y-2.5">
        {pipelineStartTime && (
          <StatRow
            icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}
            label="Duration"
            value={totalElapsed > 0 ? formatDuration(totalElapsed) : "--"}
          />
        )}
        <StatRow
          icon={<FileCode className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Files"
          value={filesProcessed ?? "--"}
        />
        <StatRow
          icon={<Layers className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Entities"
          value={entitiesFound ?? "--"}
        />
        <StatRow
          icon={<GitFork className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Relationships"
          value={edgesCreated ?? "--"}
        />
        {embeddingsStored != null && (
          <StatRow
            icon={<Sparkles className="h-3.5 w-3.5 text-muted-foreground" />}
            label="Embeddings"
            value={embeddingsStored.toLocaleString()}
          />
        )}
        {coChangeEdges != null && coChangeEdges > 0 && (
          <StatRow
            icon={<Activity className="h-3.5 w-3.5 text-muted-foreground" />}
            label="Co-change Pairs"
            value={coChangeEdges.toLocaleString()}
          />
        )}
        {highRiskNodes != null && highRiskNodes > 0 && (
          <StatRow
            icon={<Shield className="h-3.5 w-3.5 text-muted-foreground" />}
            label="High-risk Nodes"
            value={highRiskNodes.toLocaleString()}
          />
        )}
        {scipCoverage != null && (
          <StatRow
            icon={<Zap className="h-3.5 w-3.5 text-muted-foreground" />}
            label="SCIP Coverage"
            value={`${scipCoverage}%`}
            accent
          />
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Progress</span>
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isError ? "bg-destructive" : "bg-electric-cyan"
            }`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>

      {/* Last Activity Message */}
      {lastLog && (
        <div className="border-t border-border pt-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
            Latest Activity
          </p>
          <div className="flex items-start gap-2">
            <MessageSquare className="h-3 w-3 text-white/30 mt-0.5 shrink-0" />
            <p className="text-[11px] text-white/50 leading-relaxed line-clamp-2">
              {lastLog.message}
            </p>
          </div>
        </div>
      )}

      {/* Phase Timeline */}
      {phaseTimings.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
            Phase Timeline
          </p>
          <div className="space-y-1.5">
            {phaseTimings.map((pt) => {
              const isCompleted = pt.completedAt !== null
              const isCurrent = !isCompleted && isActive
              const duration = isCompleted
                ? pt.durationMs!
                : isCurrent && currentPhaseDuration
                  ? currentPhaseDuration
                  : null

              return (
                <div
                  key={pt.phase}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    {isCompleted ? (
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : isCurrent ? (
                      <span className="h-2 w-2 rounded-full bg-electric-cyan animate-pulse" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-white/20" />
                    )}
                    <span
                      className={`text-xs ${
                        isCurrent
                          ? "text-electric-cyan font-medium"
                          : isCompleted
                            ? "text-white/60"
                            : "text-white/30"
                      }`}
                    >
                      {pt.label}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-white/40 tabular-nums">
                    {duration !== null ? formatDuration(duration) : ""}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
