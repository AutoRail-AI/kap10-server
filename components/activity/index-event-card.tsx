"use client"

import { Badge } from "@/components/ui/badge"
import { GitCommit, ArrowUpCircle, ArrowDownCircle, RefreshCw, AlertTriangle } from "lucide-react"

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

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function IndexEventCard({ event }: { event: IndexEvent }) {
  const eventIcon = event.event_type === "incremental"
    ? <GitCommit className="h-4 w-4 text-electric-cyan" />
    : <RefreshCw className="h-4 w-4 text-amber-400" />

  const eventLabel = event.event_type === "incremental"
    ? "Incremental"
    : event.event_type === "full_reindex"
      ? "Full Re-index"
      : "Force Push Re-index"

  return (
    <div className="glass-panel rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {eventIcon}
          <span className="font-mono text-xs text-muted-foreground">{event.push_sha.slice(0, 8)}</span>
          <Badge variant="outline" className="text-[10px] h-5">{eventLabel}</Badge>
        </div>
        <span className="text-xs text-muted-foreground">{formatTimeAgo(event.created_at)}</span>
      </div>

      {event.commit_message && (
        <p className="text-sm text-foreground truncate">{event.commit_message}</p>
      )}

      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">{event.files_changed} files</span>
        <span className="flex items-center gap-1 text-emerald-400">
          <ArrowUpCircle className="h-3 w-3" />
          +{event.entities_added}
        </span>
        <span className="flex items-center gap-1 text-amber-400">
          <RefreshCw className="h-3 w-3" />
          ~{event.entities_updated}
        </span>
        <span className="flex items-center gap-1 text-destructive">
          <ArrowDownCircle className="h-3 w-3" />
          -{event.entities_deleted}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>Edges repaired: {event.edges_repaired}</span>
        <span>Embeddings: {event.embeddings_updated}</span>
        <span>Duration: {event.duration_ms}ms</span>
        {event.cascade_status !== "none" && event.cascade_status !== "skipped" && (
          <span>Cascade: {event.cascade_entities} entities</span>
        )}
      </div>

      {event.extraction_errors && event.extraction_errors.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          <span>{event.extraction_errors.length} extraction error(s)</span>
        </div>
      )}
    </div>
  )
}
