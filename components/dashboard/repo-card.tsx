"use client"

import { useState } from "react"
import { FolderGit2, RotateCw, Square } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useRepoStatus } from "@/hooks/use-repo-status"
import type { RepoRecord } from "@/lib/ports/relational-store"

export function RepoCard({ repo }: { repo: RepoRecord }) {
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
        : status === "error"
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

  return (
    <Link href={status === "ready" ? `/repos/${repo.id}` : "#"}>
      <div className="glass-card border-border flex flex-col gap-2 rounded-lg border p-4 hover:shadow-glow-purple">
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

        {status === "ready" && (
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs">
              {repo.fileCount ?? 0} files · {(repo.functionCount ?? 0) + (repo.classCount ?? 0)} entities
            </p>
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
              Restart Indexing
            </Button>
          </>
        )}
      </div>
    </Link>
  )
}
