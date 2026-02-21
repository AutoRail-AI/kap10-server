"use client"

import { useState, useEffect, useCallback } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  GitBranch,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
} from "lucide-react"
import type { LedgerEntry, LedgerEntryStatus } from "@/lib/ports/types"

interface TimelineResponse {
  items: LedgerEntry[]
  cursor: string | null
  hasMore: boolean
}

const STATUS_CONFIG: Record<
  LedgerEntryStatus,
  { label: string; color: string; Icon: React.ElementType }
> = {
  working: {
    label: "Working",
    color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    Icon: CheckCircle2,
  },
  broken: {
    label: "Broken",
    color: "text-red-400 bg-red-400/10 border-red-400/30",
    Icon: XCircle,
  },
  pending: {
    label: "Pending",
    color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
    Icon: AlertCircle,
  },
  committed: {
    label: "Committed",
    color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
    Icon: CheckCircle2,
  },
  reverted: {
    label: "Reverted",
    color: "text-muted-foreground bg-muted/20 border-border",
    Icon: XCircle,
  },
}

const NODE_DOT_COLOR: Record<LedgerEntryStatus, string> = {
  working: "bg-emerald-400",
  broken: "bg-red-400",
  pending: "bg-yellow-400",
  committed: "bg-blue-400",
  reverted: "bg-muted-foreground",
}

const ALL_STATUSES: LedgerEntryStatus[] = [
  "pending",
  "working",
  "broken",
  "committed",
  "reverted",
]

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function truncate(text: string, max = 120): string {
  return text.length > max ? text.slice(0, max) + "…" : text
}

export function TimelineView({ repoId }: { repoId: string }) {
  const [items, setItems] = useState<LedgerEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter state
  const [branch, setBranch] = useState<string>("")
  const [statusFilter, setStatusFilter] = useState<LedgerEntryStatus | "">("")

  const buildUrl = useCallback(
    (nextCursor?: string | null) => {
      const params = new URLSearchParams()
      if (branch) params.set("branch", branch)
      if (statusFilter) params.set("status", statusFilter)
      params.set("limit", "20")
      if (nextCursor) params.set("cursor", nextCursor)
      return `/api/repos/${repoId}/timeline?${params.toString()}`
    },
    [repoId, branch, statusFilter]
  )

  const fetchTimeline = useCallback(
    async (reset = true) => {
      if (reset) {
        setLoading(true)
        setError(null)
      } else {
        setLoadingMore(true)
      }

      try {
        const url = buildUrl(reset ? null : cursor)
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`)
        }
        const json = (await res.json()) as { data: TimelineResponse }
        const { items: newItems, cursor: newCursor, hasMore: newHasMore } = json.data

        if (reset) {
          setItems(newItems)
        } else {
          setItems((prev) => [...prev, ...newItems])
        }
        setCursor(newCursor)
        setHasMore(newHasMore)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [buildUrl, cursor]
  )

  // Reset and re-fetch when filters change
  useEffect(() => {
    fetchTimeline(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, statusFilter])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[100px] w-full" />
        <Skeleton className="h-[100px] w-full" />
        <Skeleton className="h-[100px] w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Failed to load timeline: {error}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5" />
          <input
            type="text"
            placeholder="Filter branch…"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="h-8 rounded-md border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-40"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as LedgerEntryStatus | "")}
          className="h-8 rounded-md border border-border bg-card px-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_CONFIG[s].label}
            </option>
          ))}
        </select>
      </div>

      {/* Timeline entries */}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          No ledger entries yet. Changes tracked by AI agents will appear here.
        </p>
      ) : (
        <div className="relative space-y-0">
          {/* Vertical line */}
          <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" aria-hidden />

          <div className="space-y-3">
            {items.map((entry) => {
              const cfg = STATUS_CONFIG[entry.status]
              const Icon = cfg.Icon
              const dotColor = NODE_DOT_COLOR[entry.status]
              const changesCount = entry.changes.length
              const totalAdded = entry.changes.reduce(
                (sum: number, c) => sum + c.lines_added,
                0
              )
              const totalRemoved = entry.changes.reduce(
                (sum: number, c) => sum + c.lines_removed,
                0
              )

              return (
                <div key={entry.id} className="relative flex gap-4 pl-7">
                  {/* Node dot */}
                  <span
                    className={`absolute left-[7px] top-4 h-2.5 w-2.5 rounded-full border-2 border-background ${dotColor}`}
                    aria-hidden
                  />

                  <div className="glass-card flex-1 rounded-lg border border-border p-4 space-y-2 hover:border-primary/30 transition-colors">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-foreground leading-snug flex-1">
                        {truncate(entry.prompt)}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${cfg.color}`}
                      >
                        <Icon className="h-3 w-3" />
                        {cfg.label}
                      </span>
                    </div>

                    {/* Metadata row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {entry.agent_model && (
                        <span className="font-mono">{entry.agent_model}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3" />
                        {entry.branch}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(entry.created_at)}
                      </span>
                      {changesCount > 0 && (
                        <span>
                          {changesCount} {changesCount === 1 ? "file" : "files"}
                          {totalAdded > 0 && (
                            <span className="text-emerald-400 ml-1">+{totalAdded}</span>
                          )}
                          {totalRemoved > 0 && (
                            <span className="text-red-400 ml-1">-{totalRemoved}</span>
                          )}
                        </span>
                      )}
                      {entry.commit_sha && (
                        <span className="font-mono text-blue-400">
                          {entry.commit_sha.slice(0, 7)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchTimeline(false)}
            disabled={loadingMore}
            className="gap-1.5"
          >
            {loadingMore ? (
              <Skeleton className="h-4 w-20" />
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Load more
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
