"use client"

import { FolderGit2, RotateCw } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useRepoStatus } from "@/hooks/use-repo-status"
import type { RepoRecord } from "@/lib/ports/relational-store"

export function RepoCard({ repo }: { repo: RepoRecord }) {
  const { status, progress } = useRepoStatus(
    repo.id,
    repo.status,
    repo.indexProgress ?? 0
  )

  const statusBadge =
    status === "ready"
      ? "text-electric-cyan"
      : status === "indexing"
        ? "text-primary"
        : status === "error"
          ? "text-destructive"
          : "text-muted-foreground"

  const handleRetry = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    fetch(`/api/repos/${repo.id}/retry`, { method: "POST" }).then(() => window.location.reload())
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
          <Progress value={progress} className="h-1.5" />
        )}
        {status === "ready" && (
          <p className="text-muted-foreground text-xs">
            {repo.fileCount ?? 0} files · {(repo.functionCount ?? 0) + (repo.classCount ?? 0)} entities
          </p>
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
              onClick={handleRetry}
              aria-label="Retry indexing"
            >
              <RotateCw className="mr-2 h-3.5 w-3.5" />
              Retry Indexing
            </Button>
          </>
        )}
      </div>
    </Link>
  )
}
