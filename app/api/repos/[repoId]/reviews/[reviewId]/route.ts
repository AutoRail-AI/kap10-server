import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ repoId: string; reviewId: string }> }
) {
  const { reviewId } = await params
  const container = getContainer()

  const review = await container.relationalStore.getPrReview(reviewId)
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 })
  }

  const comments = await container.relationalStore.listPrReviewComments(reviewId)

  // Group comments by checkType
  const grouped: Record<string, typeof comments> = {}
  for (const comment of comments) {
    const key = comment.checkType
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(comment)
  }

  return NextResponse.json({ review, comments, grouped })
}
