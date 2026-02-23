"use client"

import { useEffect, useMemo, useState } from "react"
import { Activity, Check, Clock, FileCode, GitFork, Layers } from "lucide-react"
import type { PipelineLogEntry } from "@/hooks/use-pipeline-logs"

interface WhatsHappeningPanelProps {
  status: string
  progress: number
  logs: PipelineLogEntry[]
  indexingStartedAt?: number | null
}

const PHASE_ORDER = ["indexing", "embedding", "ontology", "justifying"] as const
type Phase = (typeof PHASE_ORDER)[number]

const PHASE_LABELS: Record<string, string> = {
  pending: "Queued",
  indexing: "Indexing",
  embedding: "Embedding",
  ontology: "Ontology Discovery",
  justifying: "Justification",
  ready: "Complete",
  error: "Error",
  embed_failed: "Embed Failed",
  justify_failed: "Justify Failed",
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

export function WhatsHappeningPanel({ status, progress, logs, indexingStartedAt }: WhatsHappeningPanelProps) {
  const [now, setNow] = useState(Date.now())

  const isActive = ["indexing", "embedding", "justifying", "ontology", "pending"].includes(status)
  const isEndState = ["ready", "error", "embed_failed", "justify_failed"].includes(status)

  // Use server-persisted timestamp first, fall back to first log entry
  const pipelineStartTime = useMemo(
    () => indexingStartedAt ?? getPipelineStartTime(logs),
    [indexingStartedAt, logs]
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

  return (
    <div className="glass-card border-border rounded-lg border p-4 space-y-4">
      <h3 className="font-grotesk text-xs font-semibold text-foreground uppercase tracking-wider">
        What&apos;s Happening
      </h3>

      {/* Current status + total duration */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Status</span>
          </div>
          <span className="text-xs font-medium text-electric-cyan font-mono">
            {PHASE_LABELS[status] ?? status}
          </span>
        </div>
        {pipelineStartTime && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Started</span>
            </div>
            <span className="text-xs font-medium text-foreground font-mono tabular-nums">
              {new Date(pipelineStartTime).toLocaleTimeString()}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Total Duration</span>
          </div>
          <span className="text-xs font-medium text-foreground font-mono tabular-nums">
            {totalElapsed > 0 ? formatDuration(totalElapsed) : "--"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Files</span>
          </div>
          <span className="text-xs font-medium text-foreground font-mono tabular-nums">
            {filesProcessed ?? "--"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Entities</span>
          </div>
          <span className="text-xs font-medium text-foreground font-mono tabular-nums">
            {entitiesFound ?? "--"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitFork className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Edges</span>
          </div>
          <span className="text-xs font-medium text-foreground font-mono tabular-nums">
            {edgesCreated ?? "--"}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Progress</span>
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-electric-cyan transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

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
