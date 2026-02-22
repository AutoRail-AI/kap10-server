"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, ExternalLink, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ReviewStatusBadge, AutoApprovedBadge } from "@/components/repo/review-status-badge"
import { ReviewCommentCard } from "@/components/repo/review-comment-card"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "next/link"

interface Review {
  id: string
  prNumber: number
  prTitle: string
  prUrl: string
  headSha: string
  baseSha: string
  status: string
  checksPassed: number
  checksWarned: number
  checksFailed: number
  reviewBody: string | null
  autoApproved: boolean
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

interface Comment {
  id: string
  filePath: string
  lineNumber: number
  checkType: string
  severity: string
  message: string
  suggestion: string | null
  ruleTitle: string | null
  createdAt: string
}

export default function ReviewDetailPage() {
  const params = useParams()
  const router = useRouter()
  const repoId = params.repoId as string
  const reviewId = params.reviewId as string
  const [review, setReview] = useState<Review | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [grouped, setGrouped] = useState<Record<string, Comment[]>>({})
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    fetch(`/api/repos/${repoId}/reviews/${reviewId}`)
      .then((r) => r.json())
      .then((data) => {
        const d = data as { review: Review; comments: Comment[]; grouped: Record<string, Comment[]> }
        setReview(d.review)
        setComments(d.comments)
        setGrouped(d.grouped)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [repoId, reviewId])

  const handleRetry = async () => {
    setRetrying(true)
    await fetch(`/api/repos/${repoId}/reviews/${reviewId}/retry`, { method: "POST" })
    router.refresh()
    setRetrying(false)
  }

  if (loading) {
    return (
      <div className="space-y-6 py-6">
        <Skeleton className="h-[300px] w-full" />
      </div>
    )
  }

  if (!review) {
    return <div className="py-6 text-muted-foreground">Review not found</div>
  }

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/repos/${repoId}/reviews`} className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" />
          Reviews
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="font-grotesk text-lg font-semibold text-foreground">
              #{review.prNumber} {review.prTitle}
            </h1>
            <ReviewStatusBadge status={review.status} />
            {review.autoApproved && <AutoApprovedBadge />}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">{review.headSha.slice(0, 7)}</span>
            <span>
              {review.checksPassed} passed &middot; {review.checksWarned} warnings &middot; {review.checksFailed} errors
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {review.status === "failed" && (
            <Button size="sm" variant="outline" onClick={handleRetry} disabled={retrying}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              {retrying ? "Retrying..." : "Retry"}
            </Button>
          )}
          <a href={review.prUrl} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              GitHub
            </Button>
          </a>
        </div>
      </div>

      {review.reviewBody && (
        <div className="glass-card p-4 text-sm text-foreground">{review.reviewBody}</div>
      )}

      {review.errorMessage && (
        <div className="glass-card p-4 border-red-500/20 text-sm text-red-400">{review.errorMessage}</div>
      )}

      {comments.length > 0 ? (
        <div className="space-y-4">
          {Object.entries(grouped).map(([checkType, typeComments]) => (
            <div key={checkType}>
              <h3 className="text-sm font-medium text-foreground capitalize mb-2">
                {checkType} ({typeComments.length})
              </h3>
              <div className="space-y-2">
                {typeComments.map((c) => (
                  <ReviewCommentCard key={c.id} comment={c} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : review.status === "completed" ? (
        <div className="glass-card p-6 text-center text-sm text-muted-foreground">
          No findings — clean PR!
        </div>
      ) : null}
    </div>
  )
}
