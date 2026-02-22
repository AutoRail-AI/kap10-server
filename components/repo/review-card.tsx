"use client"

import Link from "next/link"
import { GitPullRequest, ExternalLink } from "lucide-react"
import { ReviewStatusBadge, AutoApprovedBadge } from "./review-status-badge"

interface ReviewCardProps {
  review: {
    id: string
    prNumber: number
    prTitle: string
    prUrl: string
    headSha: string
    status: string
    checksPassed: number
    checksWarned: number
    checksFailed: number
    autoApproved: boolean
    createdAt: string
  }
  repoId: string
}

export function ReviewCard({ review, repoId }: ReviewCardProps) {
  const timeAgo = getRelativeTime(review.createdAt)

  return (
    <div className="glass-card p-4 hover:border-primary/20 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <GitPullRequest className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/repos/${repoId}/reviews/${review.id}`}
                className="text-sm font-medium text-foreground hover:text-primary truncate"
              >
                #{review.prNumber} {review.prTitle}
              </Link>
              <ReviewStatusBadge status={review.status} />
              {review.autoApproved && <AutoApprovedBadge />}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="font-mono">{review.headSha.slice(0, 7)}</span>
              <span>
                {review.checksPassed > 0 && <span className="text-emerald-400">{review.checksPassed} passed</span>}
                {review.checksWarned > 0 && <span className="text-yellow-400"> · {review.checksWarned} warnings</span>}
                {review.checksFailed > 0 && <span className="text-red-400"> · {review.checksFailed} errors</span>}
                {review.checksPassed === 0 && review.checksWarned === 0 && review.checksFailed === 0 && "No findings"}
              </span>
              <span>{timeAgo}</span>
            </div>
          </div>
        </div>
        <a
          href={review.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
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
