"use client"

import { useState } from "react"
import { ArrowRight, CheckCircle2, Download, ExternalLink, FolderGit2, GitPullRequest, RotateCw, Square } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useRepoStatus } from "@/hooks/use-repo-status"
import type { RepoRecord } from "@/lib/ports/relational-store"

export function RepoCard({ repo, snapshotStatus }: { repo: RepoRecord; snapshotStatus?: "available" | "generating" | "failed" | null }) {
  const { status, progress, setStatus } = useRepoStatus(
    repo.id,
    repo.status,
    repo.indexProgress ?? 0
  )
  const [loading, setLoading] = useState(false)

  const statusBadge =
    status === "ready"
      ? "text-electric-cyan"
      : status === "indexing"
        ? "text-primary"
        : status === "embedding"
          ? "text-amber-400"
          : status === "justifying"
            ? "text-purple-400"
            : status === "error" || status === "embed_failed" || status === "justify_failed"
              ? "text-destructive"
              : "text-muted-foreground"

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
    setLoading(true)
    try {
      await fetch(`/api/repos/${repo.id}/retry`, { method: "POST" })
      setStatus("indexing")
    } finally {
      setLoading(false)
    }
  }

  const card = (
    <div className={`glass-card border-border flex flex-col gap-2 rounded-lg border p-4 ${status === "ready" ? "hover:shadow-glow-purple" : ""}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderGit2 className="text-muted-foreground h-4 w-4" />
            <div>
              <p className="font-grotesk text-sm font-semibold text-foreground">
                {repo.name}
              </p>
              <p className="text-muted-foreground text-xs">{repo.fullName}</p>
            </div>
          </div>
          <span className={`text-xs font-medium ${statusBadge}`}>
            {status}
          </span>
        </div>

        {status === "indexing" && (
          <>
            <Progress value={progress} className="h-1.5" />
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs">
                Indexing… {progress}%
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleStop}
                disabled={loading}
                className="h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
              >
                <Square className="h-3 w-3" />
                Stop
              </Button>
            </div>
          </>
        )}

        {status === "embedding" && (
          <>
            <Progress value={progress} className="h-1.5" />
            <p className="text-muted-foreground text-xs">
              Embedding… {progress}%
            </p>
          </>
        )}

        {status === "justifying" && (
          <>
            <Progress value={progress} className="h-1.5" />
            <p className="text-muted-foreground text-xs">
              Justifying… {progress}%
            </p>
          </>
        )}

        {status === "justify_failed" && (
          <>
            {repo.errorMessage && (
              <p className="text-destructive text-xs truncate" title={repo.errorMessage}>
                {repo.errorMessage}
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRestart}
              disabled={loading}
              className="h-7 gap-1.5 text-xs"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Retry Justification
            </Button>
          </>
        )}

        {status === "embed_failed" && (
          <>
            {repo.errorMessage && (
              <p className="text-destructive text-xs truncate" title={repo.errorMessage}>
                {repo.errorMessage}
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRestart}
              disabled={loading}
              className="h-7 gap-1.5 text-xs"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Retry Embedding
            </Button>
          </>
        )}

        {status === "ready" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-muted-foreground text-xs">
                  {repo.fileCount ?? 0} files · {(repo.functionCount ?? 0) + (repo.classCount ?? 0)} entities
                </p>
                {repo.lastIndexedAt && (
                  <FreshnessIndicator lastIndexedAt={repo.lastIndexedAt} />
                )}
                {snapshotStatus === "available" && (
                  <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] font-normal text-emerald-400 border-emerald-400/30">
                    <Download className="h-2.5 w-2.5" />
                    Local Sync
                  </Badge>
                )}
                {snapshotStatus === "generating" && (
                  <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] font-normal text-amber-400 border-amber-400/30 animate-pulse">
                    <Download className="h-2.5 w-2.5" />
                    Syncing
                  </Badge>
                )}
                {snapshotStatus === "failed" && (
                  <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] font-normal text-destructive border-destructive/30">
                    <Download className="h-2.5 w-2.5" />
                    Sync Failed
                  </Badge>
                )}
              </div>
              {repo.onboardingPrUrl && (
                <a
                  href={repo.onboardingPrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1"
                >
                  <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] font-normal text-electric-cyan border-electric-cyan/30 hover:bg-electric-cyan/10">
                    <GitPullRequest className="h-3 w-3" />
                    Onboarding PR
                    <ExternalLink className="h-2.5 w-2.5" />
                  </Badge>
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Button
                  size="sm"
                  className="w-full bg-rail-fade hover:opacity-90 gap-1.5 h-7 text-xs"
                  tabIndex={-1}
                >
                  <ArrowRight className="h-3 w-3" />
                  View Details
                </Button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRestart}
                disabled={loading}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <RotateCw className="h-3 w-3" />
                Re-index
              </Button>
            </div>
          </div>
        )}

        {status === "error" && (
          <>
            {repo.errorMessage && (
              <p className="text-destructive text-xs truncate" title={repo.errorMessage}>
                {repo.errorMessage}
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRestart}
              disabled={loading}
              className="h-7 gap-1.5 text-xs"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Re-index
            </Button>
          </>
        )}
      </div>
  )

  if (status === "ready") {
    return <Link href={`/repos/${repo.id}`}>{card}</Link>
  }
  return card
}

function FreshnessIndicator({ lastIndexedAt }: { lastIndexedAt: Date | string }) {
  const lastIndexed = new Date(lastIndexedAt)
  const hoursAgo = (Date.now() - lastIndexed.getTime()) / (1000 * 60 * 60)

  let dotColor: string
  let label: string

  if (hoursAgo < 1) {
    dotColor = "bg-emerald-400"
    const mins = Math.floor(hoursAgo * 60)
    label = mins < 1 ? "Just indexed" : `${mins}m ago`
  } else if (hoursAgo < 24) {
    dotColor = "bg-amber-400"
    label = `${Math.floor(hoursAgo)}h ago`
  } else {
    dotColor = "bg-destructive"
    label = `${Math.floor(hoursAgo / 24)}d ago`
  }

  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground" title={`Last indexed: ${lastIndexed.toLocaleString()}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  )
}
