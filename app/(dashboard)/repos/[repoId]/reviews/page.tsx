"use client"

import { GitPullRequest } from "lucide-react"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { ReviewCard } from "@/components/repo/review-card"
import { Skeleton } from "@/components/ui/skeleton"

interface ReviewItem {
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

export default function ReviewsPage() {
  const params = useParams()
  const repoId = params.repoId as string
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/repos/${repoId}/reviews`)
      .then((r) => r.json())
      .then((data) => {
        setReviews((data as { items: ReviewItem[] }).items ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [repoId])

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">PR Reviews</h1>
        <p className="text-sm text-muted-foreground">Architecture reviews for pull requests</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-[72px] w-full" />
          <Skeleton className="h-[72px] w-full" />
          <Skeleton className="h-[72px] w-full" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <GitPullRequest className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No PR reviews yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Reviews will appear automatically when PRs are opened.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} repoId={repoId} />
          ))}
        </div>
      )}
    </div>
  )
}
