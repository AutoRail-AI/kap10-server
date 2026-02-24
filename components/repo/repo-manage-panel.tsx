"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { AlertTriangle, RefreshCw, Clock, GitBranch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

interface RepoManagePanelProps {
  repoId: string
  repoName: string
  defaultBranch: string
  lastIndexedAt: string | null
}

export function RepoManagePanel({
  repoId,
  repoName,
  defaultBranch,
  lastIndexedAt,
}: RepoManagePanelProps) {
  const router = useRouter()
  const [reindexing, setReindexing] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleReindex = async () => {
    setReindexing(true)
    setError(null)
    try {
      const res = await fetch(`/api/repos/${repoId}/reindex`, { method: "POST" })
      if (res.status === 429) {
        setRateLimited(true)
        setConfirmOpen(false)
        return
      }
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        setError(body?.error ?? "Failed to start re-index")
        setConfirmOpen(false)
        return
      }
      // Success — navigate to the pipeline page to see live progress
      router.push(`/repos/${repoId}/pipeline`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setReindexing(false)
      setConfirmOpen(false)
    }
  }

  const lastIndexed = lastIndexedAt
    ? formatTimeAgo(new Date(lastIndexedAt))
    : "Never"

  return (
    <div className="rounded-lg border border-white/10 bg-white/2 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Pipeline Management
        </p>
      </div>

      {/* Info row */}
      <div className="flex flex-wrap gap-4 text-xs text-white/60">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-white/40" />
          <span>Last indexed: <span className="text-foreground font-medium">{lastIndexed}</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3 w-3 text-white/40" />
          <span>Branch: <span className="text-foreground font-mono font-medium">{defaultBranch}</span></span>
        </div>
      </div>

      {/* Re-index action */}
      {!confirmOpen ? (
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-sm text-foreground font-medium">Re-index Repository</p>
            <p className="text-xs text-white/40">
              Re-run the full pipeline: clone, index, embed, and analyze.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-white/15 text-white/60 hover:bg-white/5 hover:text-white"
            onClick={() => setConfirmOpen(true)}
            disabled={rateLimited}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            {rateLimited ? "Rate Limited (1/hr)" : "Re-index"}
          </Button>
        </div>
      ) : (
        <div className="rounded-md border border-warning/20 bg-warning/5 p-3 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Re-index {repoName}?
              </p>
              <p className="text-xs text-white/50">
                This will re-run the entire pipeline from scratch. The existing graph data will be
                replaced once the new indexing completes. Rate limited to 1 per hour.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-white/50 hover:text-white"
              onClick={() => setConfirmOpen(false)}
              disabled={reindexing}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-warning/20 text-warning hover:bg-warning/30 border border-warning/30"
              onClick={handleReindex}
              disabled={reindexing}
            >
              {reindexing ? (
                <>
                  <Spinner className="mr-2 h-3.5 w-3.5" />
                  Starting…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Confirm Re-index
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Error / rate-limit feedback */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      {rateLimited && (
        <p className="text-xs text-warning">
          Re-index rate limited. You can trigger another re-index in 1 hour.
        </p>
      )}
    </div>
  )
}

function formatTimeAgo(date: Date): string {
  const ms = Date.now() - date.getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
