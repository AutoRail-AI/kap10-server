"use client"

import { useEffect, useState } from "react"
import { Clock, FileCode, Layers, GitFork, Activity } from "lucide-react"
import type { PipelineLogEntry } from "@/hooks/use-pipeline-logs"

interface WhatsHappeningPanelProps {
  status: string
  progress: number
  logs: PipelineLogEntry[]
}

function getPhaseLabel(status: string): string {
  switch (status) {
    case "pending": return "Queued"
    case "indexing": return "Indexing"
    case "embedding": return "Embedding"
    case "ontology": return "Ontology Discovery"
    case "justifying": return "Justification"
    case "ready": return "Complete"
    case "error":
    case "embed_failed":
    case "justify_failed":
      return "Error"
    default: return status
  }
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
    // Check meta field for counts
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

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function estimateTimeRemaining(progress: number): string {
  if (progress <= 0 || progress >= 100) return "--"
  // Rough estimate: ~3 minutes total for a medium repo
  const totalEstimate = 180000 // 3 min in ms
  const remaining = totalEstimate * ((100 - progress) / 100)
  return `~${formatDuration(remaining)}`
}

export function WhatsHappeningPanel({ status, progress, logs }: WhatsHappeningPanelProps) {
  const [elapsed, setElapsed] = useState(0)
  const [startTime] = useState(() => {
    if (logs.length > 0 && logs[0]) {
      return new Date(logs[0].timestamp).getTime()
    }
    return Date.now()
  })

  const isActive = ["indexing", "embedding", "justifying", "ontology", "pending"].includes(status)

  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime)
    }, 1000)
    return () => clearInterval(interval)
  }, [isActive, startTime])

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

  const metrics = [
    {
      icon: Activity,
      label: "Current Phase",
      value: getPhaseLabel(status),
    },
    {
      icon: Clock,
      label: "Duration",
      value: formatDuration(elapsed),
    },
    {
      icon: FileCode,
      label: "Files Processed",
      value: filesProcessed ?? "--",
    },
    {
      icon: Layers,
      label: "Entities Found",
      value: entitiesFound ?? "--",
    },
    {
      icon: GitFork,
      label: "Edges Created",
      value: edgesCreated ?? "--",
    },
  ]

  return (
    <div className="glass-card border-border rounded-lg border p-4 space-y-4">
      <h3 className="font-grotesk text-xs font-semibold text-foreground uppercase tracking-wider">
        What&apos;s Happening
      </h3>
      <div className="space-y-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <metric.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{metric.label}</span>
            </div>
            <span className="text-xs font-medium text-electric-cyan font-mono">
              {metric.value}
            </span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Progress</span>
          <span className="text-[10px] text-muted-foreground font-mono">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-electric-cyan transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Estimated time */}
      {isActive && (
        <div className="flex items-center justify-between pt-1 border-t border-border">
          <span className="text-[10px] text-muted-foreground">Est. remaining</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {estimateTimeRemaining(progress)}
          </span>
        </div>
      )}
    </div>
  )
}
