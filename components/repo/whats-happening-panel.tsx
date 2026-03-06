"use client"

import { Activity, AlertTriangle, Check, Clock, FileCode, GitFork, Layers, Shield, Sparkles, Zap } from "lucide-react"
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

  // Step-level stats from pipeline run data
  const stepStats = useMemo(() => {
    if (!steps || steps.length === 0) return null
    const completed = steps.filter((s) => s.status === "completed" || s.status === "skipped").length
    const currentStep = steps.find((s) => s.status === "running")
    return { completed, total: steps.length, currentStep }
  }, [steps])

  return (
    <div className="flex flex-col h-full rounded-lg border border-border bg-white/[0.015] overflow-hidden">
      {/* Fixed header section */}
      <div className="shrink-0 p-3 space-y-3">
        {/* Title + Status */}
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            What&apos;s Happening
          </h3>
          <div className="flex items-center gap-1.5">
            {isError ? (
              <AlertTriangle className="h-3 w-3 text-destructive" />
            ) : isActive ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-electric-cyan/40" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-electric-cyan/70" />
              </span>
            ) : (
              <Check className="h-3 w-3 text-emerald-400" />
            )}
            <span className={`text-[11px] font-medium ${isError ? "text-destructive" : isActive ? "text-electric-cyan" : "text-emerald-400"}`}>
              {PHASE_LABELS[status] ?? status}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
          {STATUS_DESCRIPTIONS[status] ?? "Processing..."}
        </p>

        {/* Current Step */}
        {stepStats?.currentStep && isActive && (
          <div className="flex items-center gap-2 rounded bg-electric-cyan/5 border border-electric-cyan/10 px-2.5 py-1.5">
            <Zap className="h-3 w-3 text-electric-cyan shrink-0" />
            <span className="text-[11px] text-electric-cyan font-medium truncate">
              {stepStats.currentStep.label}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto font-mono tabular-nums shrink-0">
              {stepStats.completed}/{stepStats.total}
            </span>
          </div>
        )}

        {/* Error Detail */}
        {isError && errorMessage && (
          <div className="rounded bg-destructive/5 border border-destructive/10 px-2.5 py-1.5">
            <p className="text-[10px] text-destructive/80 leading-relaxed line-clamp-2">
              {errorMessage}
            </p>
          </div>
        )}

        {/* Compact Stats Grid — 2 columns */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {pipelineStartTime && (
            <MetricItem icon={<Clock className="h-3 w-3" />} label="Duration" value={totalElapsed > 0 ? formatDuration(totalElapsed) : "--"} />
          )}
          <MetricItem icon={<FileCode className="h-3 w-3" />} label="Files" value={filesProcessed ?? "--"} />
          <MetricItem icon={<Layers className="h-3 w-3" />} label="Entities" value={entitiesFound ?? "--"} />
          <MetricItem icon={<GitFork className="h-3 w-3" />} label="Relations" value={edgesCreated ?? "--"} />
          {embeddingsStored != null && (
            <MetricItem icon={<Sparkles className="h-3 w-3" />} label="Embeddings" value={embeddingsStored.toLocaleString()} />
          )}
          {coChangeEdges != null && coChangeEdges > 0 && (
            <MetricItem icon={<Activity className="h-3 w-3" />} label="Co-change" value={coChangeEdges.toLocaleString()} />
          )}
          {highRiskNodes != null && highRiskNodes > 0 && (
            <MetricItem icon={<Shield className="h-3 w-3" />} label="High-risk" value={highRiskNodes.toLocaleString()} />
          )}
          {scipCoverage != null && (
            <MetricItem icon={<Zap className="h-3 w-3" />} label="SCIP" value={`${scipCoverage}%`} accent />
          )}
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/50">Progress</span>
            <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums">{progress}%</span>
          </div>
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isError ? "bg-destructive" : "bg-electric-cyan"
              }`}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Scrollable Phase Timeline */}
      {phaseTimings.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col border-t border-white/[0.06]">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/25 px-3 pt-2.5 pb-1.5 shrink-0">
            Phase Timeline
          </p>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            <div className="space-y-0.5">
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
                    className="flex items-center justify-between py-1"
                  >
                    <div className="flex items-center gap-2">
                      {isCompleted ? (
                        <Check className="h-3 w-3 text-emerald-400/70 shrink-0" />
                      ) : isCurrent ? (
                        <span className="h-2 w-2 rounded-full bg-electric-cyan animate-pulse shrink-0 ml-0.5 mr-0.5" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-white/10 shrink-0 ml-0.5 mr-0.5" />
                      )}
                      <span
                        className={`text-[11px] ${
                          isCurrent
                            ? "text-electric-cyan font-medium"
                            : isCompleted
                              ? "text-white/40"
                              : "text-white/20"
                        }`}
                      >
                        {pt.label}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-white/25 tabular-nums">
                      {duration !== null ? formatDuration(duration) : ""}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricItem({ icon, label, value, accent }: {
  icon: React.ReactNode
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span className="text-muted-foreground/40">{icon}</span>
      <span className="text-[10px] text-muted-foreground/50">{label}</span>
      <span className={`text-[11px] font-mono tabular-nums ml-auto ${accent ? "text-electric-cyan" : "text-foreground/80"}`}>
        {value}
      </span>
    </div>
  )
}
