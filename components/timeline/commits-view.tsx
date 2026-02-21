"use client"

import { useState, useEffect, useCallback } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { GitCommit, FileText, RotateCcw, Sparkles } from "lucide-react"
import type { LedgerSummary } from "@/lib/ports/types"

function truncateSha(sha: string): string {
  return sha.slice(0, 7)
}

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

export function CommitsView({ repoId }: { repoId: string }) {
  const [summaries, setSummaries] = useState<LedgerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSummaries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/repos/${repoId}/commits`)
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`)
      }
      const json = (await res.json()) as { data: LedgerSummary[] }
      setSummaries(json.data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [repoId])

  useEffect(() => {
    fetchSummaries()
  }, [fetchSummaries])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[120px] w-full" />
        <Skeleton className="h-[120px] w-full" />
        <Skeleton className="h-[120px] w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Failed to load commits: {error}
      </p>
    )
  }

  if (summaries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No committed AI sessions yet. Commit summaries appear here after each push.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {summaries.map((summary) => (
        <div
          key={summary.id}
          className="glass-card rounded-lg border border-border p-4 space-y-3 hover:border-primary/30 transition-colors"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <GitCommit className="h-4 w-4 text-primary shrink-0" />
              <span className="font-mono text-sm text-foreground">
                {truncateSha(summary.commit_sha)}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatRelativeTime(summary.created_at)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
              {summary.branch}
            </span>
          </div>

          {/* Prompt summary */}
          {summary.prompt_summary && (
            <p className="text-sm text-foreground leading-snug">
              {summary.prompt_summary}
            </p>
          )}

          {/* Metadata grid */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {summary.entry_count} {summary.entry_count === 1 ? "session" : "sessions"}
            </span>

            <span className="flex items-center gap-1.5">
              <span className="text-emerald-400 font-medium">
                +{summary.total_lines_added}
              </span>
              <span className="text-red-400 font-medium">
                -{summary.total_lines_removed}
              </span>
              <span>across {summary.total_files_changed} files</span>
            </span>

            {summary.rewind_count > 0 && (
              <span className="flex items-center gap-1 text-yellow-400">
                <RotateCcw className="h-3 w-3" />
                {summary.rewind_count} {summary.rewind_count === 1 ? "rewind" : "rewinds"}
              </span>
            )}

            {summary.rules_generated.length > 0 && (
              <span className="flex items-center gap-1 text-primary">
                <Sparkles className="h-3 w-3" />
                {summary.rules_generated.length}{" "}
                {summary.rules_generated.length === 1 ? "rule" : "rules"} generated
              </span>
            )}
          </div>

          {/* Rules chips */}
          {summary.rules_generated.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.rules_generated.map((rule) => (
                <span
                  key={rule}
                  className="rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-xs font-mono text-primary"
                >
                  {rule}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
