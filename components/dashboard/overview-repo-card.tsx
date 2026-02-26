"use client"

import { Folder, FolderGit2 } from "lucide-react"
import Link from "next/link"

interface OverviewRepoCardProps {
  repo: {
    id: string
    name: string
    fullName: string
    provider: string
    status: string
    fileCount?: number | null
    lastIndexedAt?: Date | null
  }
}

/**
 * Compact repo card for overview. GitHub icon vs local folder,
 * sync status dot (Electric Cyan = Live, Gray = Offline), key metric.
 */
export function OverviewRepoCard({ repo }: OverviewRepoCardProps) {
  const isReady = repo.status === "ready"
  const _isLive = isReady && repo.lastIndexedAt
  const lastIndexed = repo.lastIndexedAt
    ? new Date(repo.lastIndexedAt)
    : null
  const hoursAgo = lastIndexed
    ? (Date.now() - lastIndexed.getTime()) / (1000 * 60 * 60)
    : null

  const syncLabel =
    hoursAgo !== null
      ? hoursAgo < 1
        ? `${Math.floor(hoursAgo * 60)} mins ago`
        : hoursAgo < 24
          ? `${Math.floor(hoursAgo)}h ago`
          : `${Math.floor(hoursAgo / 24)}d ago`
      : null

  const dotColor = isReady
    ? hoursAgo !== null && hoursAgo < 24
      ? "bg-electric-cyan shadow-[0_0_6px_rgba(0,229,255,0.5)] animate-pulse"
      : "bg-muted-foreground"
    : "bg-muted-foreground"

  const Icon =
    repo.provider.toLowerCase() === "github" ? FolderGit2 : Folder

  return (
    <Link href={isReady ? `/repos/${repo.id}` : "/repos"}>
      <div className="glass-card group flex flex-col gap-3 rounded-lg border border-border p-4 transition-all duration-200 hover:shadow-glow-cyan hover:border-electric-cyan/30">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/20 group-hover:border-electric-cyan/30 group-hover:bg-electric-cyan/10 transition-colors">
              <Icon className="h-4 w-4 text-muted-foreground group-hover:text-electric-cyan transition-colors" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-grotesk text-sm font-semibold text-foreground group-hover:text-electric-cyan transition-colors">
                {repo.name}
              </p>
              <p className="truncate text-xs text-muted-foreground font-mono">
                {repo.fullName}
              </p>
            </div>
          </div>
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`}
            title={syncLabel ?? repo.status}
          />
        </div>
        <p className="text-xs font-mono text-muted-foreground">
          {isReady
            ? `${repo.fileCount?.toLocaleString() ?? 0} files indexed`
            : syncLabel
              ? `Last sync: ${syncLabel}`
              : repo.status}
        </p>
      </div>
    </Link>
  )
}
