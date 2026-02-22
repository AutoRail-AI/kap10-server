"use client"

import { GitMerge } from "lucide-react"

interface MergeHistoryCardProps {
  merge: {
    id: string
    commitSha: string
    branch: string
    entryCount: number
    narrative: string
    createdAt: string
  }
}

export function MergeHistoryCard({ merge }: MergeHistoryCardProps) {
  const timeAgo = getRelativeTime(merge.createdAt)
  const prMatch = merge.commitSha.match(/pr-(\d+)/)
  const prNumber = prMatch ? prMatch[1] : null

  return (
    <div className="glass-card p-4">
      <div className="flex items-start gap-3">
        <GitMerge className="h-4 w-4 text-primary mt-1 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-foreground">
              {prNumber ? `PR #${prNumber}` : "Merge"} &rarr; {merge.branch}
            </span>
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{merge.narrative}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{merge.entryCount} AI interaction{merge.entryCount !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function getRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
