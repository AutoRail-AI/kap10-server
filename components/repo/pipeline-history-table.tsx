"use client"

import { Clock, FileCode, Layers, RefreshCw } from "lucide-react"

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

const typeLabels: Record<string, { label: string; classes: string }> = {
  full_reindex: { label: "Full", classes: "text-electric-cyan border-electric-cyan/30" },
  incremental: { label: "Incremental", classes: "text-emerald-400 border-emerald-400/30" },
  force_push_reindex: { label: "Force", classes: "text-warning border-warning/30" },
}

const triggerLabels: Record<string, { label: string; classes: string }> = {
  initial: { label: "Initial", classes: "text-electric-cyan border-electric-cyan/30" },
  retry: { label: "Retry", classes: "text-warning border-warning/30" },
  reindex: { label: "Reindex", classes: "text-violet-400 border-violet-400/30" },
  webhook: { label: "Webhook", classes: "text-emerald-400 border-emerald-400/30" },
}

const statusColors: Record<string, string> = {
  running: "text-electric-cyan",
  completed: "text-emerald-400",
  failed: "text-destructive",
  cancelled: "text-warning",
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function formatAge(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (h < 1) return `${Math.max(1, Math.floor(h * 60))}m ago`
  if (h < 24) return `${Math.floor(h)}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function PipelineHistoryTable({ events, runs, repoId }: { events: IndexEvent[]; runs?: PipelineRun[]; repoId?: string }) {
  if (events.length === 0 && (!runs || runs.length === 0)) {
    return (
      <div className="rounded-lg border border-white/10 p-12 text-center">
        <Clock className="mx-auto h-8 w-8 text-white/10 mb-3" />
        <p className="font-grotesk text-sm font-semibold text-foreground">
          No indexing history
        </p>
        <p className="text-xs text-white/40 mt-1">
          Pipeline events will appear here after the first indexing run.
        </p>
      </div>
    )
  }

  const thBase =
    "h-9 px-4 text-left text-[10px] font-semibold uppercase tracking-wider text-white/40 select-none"

  return (
    <div className="space-y-4">
      {/* Pipeline Runs section */}
      {runs && runs.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-white/10">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-white/2">
                <th className={thBase}>Run</th>
                <th className={thBase}>When</th>
                <th className={thBase}>Trigger</th>
                <th className={thBase}>Status</th>
                <th className={thBase}>Duration</th>
                <th className={thBase}>
                  <FileCode className="inline h-3 w-3 mr-1" />
                  Files
                </th>
                <th className={thBase}>
                  <Layers className="inline h-3 w-3 mr-1" />
                  Entities
                </th>
                <th className={thBase}>
                  <RefreshCw className="inline h-3 w-3 mr-1" />
                  Edges
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {runs.map((run) => {
                const trigger = triggerLabels[run.triggerType] ?? triggerLabels.initial!
                const runUrl = repoId ? `/repos/${repoId}/activity/${run.id}` : undefined
                return (
                  <tr
                    key={run.id}
                    className={`group transition-colors hover:bg-white/3 ${runUrl ? "cursor-pointer" : ""}`}
                    onClick={runUrl ? () => window.open(runUrl, "_blank") : undefined}
                  >
                    <td className="px-4 py-2.5 font-mono text-[10px] text-electric-cyan/70">
                      {run.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-white/60">
                      {formatAge(run.startedAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${trigger.classes}`}>
                        {trigger.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium ${statusColors[run.status] ?? "text-white/60"}`}>
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-white/60 tabular-nums">
                      {run.durationMs != null ? formatDuration(run.durationMs) : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-white/60 tabular-nums">
                      {run.fileCount?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-emerald-400 tabular-nums">
                      {run.entitiesWritten?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-white/40 tabular-nums">
                      {run.edgesWritten?.toLocaleString() ?? "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legacy IndexEvent section */}
      {events.length > 0 && (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10 bg-white/2">
            <th className={thBase}>When</th>
            <th className={thBase}>Type</th>
            <th className={thBase}>Duration</th>
            <th className={thBase}>
              <FileCode className="inline h-3 w-3 mr-1" />
              Files
            </th>
            <th className={thBase}>
              <Layers className="inline h-3 w-3 mr-1" />
              Added
            </th>
            <th className={thBase}>Updated</th>
            <th className={thBase}>Deleted</th>
            <th className={thBase}>
              <RefreshCw className="inline h-3 w-3 mr-1" />
              Edges
            </th>
            <th className={thBase}>SHA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/6">
          {events.map((evt) => {
            const cfg = typeLabels[evt.event_type] ?? typeLabels.full_reindex!
            return (
              <tr
                key={evt.workflow_id + evt.created_at}
                className="group transition-colors hover:bg-white/3"
              >
                <td className="px-4 py-2.5 text-xs text-white/60">
                  {formatAge(evt.created_at)}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.classes}`}
                  >
                    {cfg.label}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-white/60 tabular-nums">
                  {formatDuration(evt.duration_ms)}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-white/60 tabular-nums">
                  {evt.files_changed.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-emerald-400 tabular-nums">
                  +{evt.entities_added.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-electric-cyan tabular-nums">
                  ~{evt.entities_updated.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-destructive tabular-nums">
                  -{evt.entities_deleted.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-white/40 tabular-nums">
                  {evt.edges_repaired.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-white/30">
                  {evt.push_sha.slice(0, 7)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
      )}
    </div>
  )
}
