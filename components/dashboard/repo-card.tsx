"use client"

import { useState } from "react"
import { ArrowRight, Download, ExternalLink, FolderGit2, GitPullRequest, RotateCw, Shield, Square, AlertCircle, Loader2 } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useRepoStatus } from "@/hooks/use-repo-status"
import type { RepoRecord } from "@/lib/ports/relational-store"

const statusColors: Record<string, string> = {
  pending: "bg-muted/10 text-muted-foreground border-border",
  indexing: "bg-primary/10 text-primary border-primary/20",
  embedding: "bg-warning/10 text-warning border-warning/20",
  justifying: "bg-rail-purple/10 text-rail-purple border-rail-purple/20",
  ready: "bg-electric-cyan/10 text-electric-cyan border-electric-cyan/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
  embed_failed: "bg-destructive/10 text-destructive border-destructive/20",
  justify_failed: "bg-destructive/10 text-destructive border-destructive/20",
}

export function RepoCard({ repo, snapshotStatus, snapshotVersion }: { repo: RepoRecord; snapshotStatus?: "available" | "generating" | "failed" | null; snapshotVersion?: number }) {
  const { status, progress, setStatus } = useRepoStatus(
    repo.id,
    repo.status,
    repo.indexProgress ?? 0
  )
  const [loading, setLoading] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)

  const handleStop = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setLoading(true)
    try {
      await fetch(`/api/repos/${repo.id}/stop`, { method: "POST" })
      setStatus("error")
    } finally {
      setLoading(false)
    }
  }

  const handleRestart = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (loading || rateLimited) return
    setLoading(true)
    try {
      const res = await fetch(`/api/repos/${repo.id}/retry`, { method: "POST" })
      if (res.status === 429) {
        setRateLimited(true)
        setTimeout(() => setRateLimited(false), 60_000)
        return
      }
      if (res.ok) {
        setStatus("indexing")
      }
    } finally {
      setLoading(false)
    }
  }

  const isProcessing = status === "indexing" || status === "embedding" || status === "justifying"
  const isError = status === "error" || status === "embed_failed" || status === "justify_failed"
  const isReady = status === "ready"

  const cardContent = (
    <div className={`glass-card group relative flex flex-col gap-4 rounded-lg border border-border p-5 transition-all duration-300 ${isReady ? "hover:shadow-glow-purple hover:border-primary/30" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 overflow-hidden">
          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/20 ${isReady ? "group-hover:border-electric-cyan/30 group-hover:bg-electric-cyan/10 transition-colors" : ""}`}>
            <FolderGit2 className={`h-4 w-4 text-muted-foreground ${isReady ? "group-hover:text-electric-cyan transition-colors" : ""}`} />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-grotesk text-sm font-semibold text-foreground group-hover:text-electric-cyan transition-colors">
                {repo.name}
              </h3>
              <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-medium uppercase tracking-wider ${statusColors[status] ?? statusColors.pending}`}>
                {status.replace("_", " ")}
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground font-mono opacity-80">
              {repo.fullName}
            </p>
          </div>
        </div>
        
        {/* Actions (Top Right) */}
        {isReady && (
          <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
             <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
               <ArrowRight className="h-4 w-4" />
             </Button>
          </div>
        )}
      </div>

      {/* Processing State */}
      {isProcessing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-mono animate-pulse">
              {status === "indexing" ? "Indexing codebase..." : 
               status === "embedding" ? "Generating embeddings..." : 
               "Analyzing patterns..."}
            </span>
            <span className="font-mono text-foreground">{progress}%</span>
          </div>
          <Progress value={progress} className="h-1 bg-muted/20" indicatorClassName={
            status === "indexing" ? "bg-primary" :
            status === "embedding" ? "bg-warning" :
            "bg-electric-cyan"
          } />
          <div className="flex justify-end pt-1">
             <Button
                size="sm"
                variant="ghost"
                onClick={handleStop}
                disabled={loading}
                className="h-6 gap-1.5 px-2 text-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Square className="h-3 w-3" />
                Stop Process
              </Button>
          </div>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 text-destructive shrink-0" />
            <div className="space-y-1 overflow-hidden">
              <p className="text-xs font-medium text-foreground">Process Failed</p>
              {repo.errorMessage && (
                <p className="truncate text-[10px] text-muted-foreground" title={repo.errorMessage}>
                  {repo.errorMessage}
                </p>
              )}
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRestart}
              disabled={loading || rateLimited}
              className="h-7 gap-1.5 border-destructive/30 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
              {rateLimited ? "Wait 1m" : "Retry"}
            </Button>
          </div>
        </div>
      )}

      {/* Ready State Metrics */}
      {isReady && (
        <div className="grid grid-cols-2 gap-4 border-t border-border/50 pt-4">
          <div className="space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Files</p>
            <p className="font-mono text-sm text-foreground">{repo.fileCount?.toLocaleString() ?? 0}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Entities</p>
            <p className="font-mono text-sm text-foreground">{((repo.functionCount ?? 0) + (repo.classCount ?? 0)).toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Footer Metadata */}
      {isReady && (
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            {repo.lastIndexedAt && <FreshnessIndicator lastIndexedAt={repo.lastIndexedAt} />}
            
            {snapshotStatus === "available" && (
              <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] font-normal text-emerald-400 border-emerald-400/30 bg-emerald-400/5">
                <Download className="h-2.5 w-2.5" />
                Synced
                {snapshotVersion && snapshotVersion >= 2 && <span className="text-emerald-400/70 ml-0.5">v2</span>}
              </Badge>
            )}
          </div>

          {repo.onboardingPrUrl && (
            <a
              href={repo.onboardingPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 hover:opacity-80 transition-opacity"
            >
              <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] font-normal text-electric-cyan border-electric-cyan/30 bg-electric-cyan/5 hover:bg-electric-cyan/10 transition-colors cursor-pointer">
                <GitPullRequest className="h-3 w-3" />
                PR
                <ExternalLink className="h-2.5 w-2.5" />
              </Badge>
            </a>
          )}
        </div>
      )}
    </div>
  )

  if (isReady) {
    return <Link href={`/repos/${repo.id}`} className="block h-full">{cardContent}</Link>
  }
  return <div className="h-full">{cardContent}</div>
}

function FreshnessIndicator({ lastIndexedAt }: { lastIndexedAt: Date | string }) {
  const lastIndexed = new Date(lastIndexedAt)
  const hoursAgo = (Date.now() - lastIndexed.getTime()) / (1000 * 60 * 60)

  let dotColor: string
  let label: string

  if (hoursAgo < 1) {
    dotColor = "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]"
    const mins = Math.floor(hoursAgo * 60)
    label = mins < 1 ? "Just now" : `${mins}m ago`
  } else if (hoursAgo < 24) {
    dotColor = "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]"
    label = `${Math.floor(hoursAgo)}h ago`
  } else {
    dotColor = "bg-muted-foreground"
    label = `${Math.floor(hoursAgo / 24)}d ago`
  }

  return (
    <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground" title={`Last indexed: ${lastIndexed.toLocaleString()}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  )
}
