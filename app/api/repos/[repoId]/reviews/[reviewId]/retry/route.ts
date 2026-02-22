import { NextRequest, NextResponse } from "next/server"
import { getContainer } from "@/lib/di/container"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ repoId: string; reviewId: string }> }
) {
  const { repoId, reviewId } = await params
  const container = getContainer()

  const review = await container.relationalStore.getPrReview(reviewId)
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 })
  }

  if (review.status !== "failed") {
    return NextResponse.json({ error: "Only failed reviews can be retried" }, { status: 409 })
  }

  // Reset status to pending
  await container.relationalStore.updatePrReview(reviewId, {
    status: "pending",
    errorMessage: null,
  })

  // Lookup repo for GitHub details
  const repo = await container.relationalStore.getRepo("", repoId)
  if (!repo) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 })
  }

  // Get installation
  const installation = await container.relationalStore.getInstallation(repo.organizationId)
  if (!installation) {
    return NextResponse.json({ error: "No GitHub installation" }, { status: 400 })
  }

  const [owner, repoName] = (repo.githubFullName ?? repo.fullName).split("/")

  // Start new workflow
  const workflowId = `review-retry-${repoId}-${review.prNumber}-${review.headSha}-${Date.now()}`
  await container.workflowEngine.startWorkflow({
    workflowFn: "reviewPrWorkflow",
    workflowId,
    args: [{
      orgId: repo.organizationId,
      repoId,
      prNumber: review.prNumber,
      installationId: installation.installationId,
      headSha: review.headSha,
      baseSha: review.baseSha,
      owner: owner ?? "",
      repo: repoName ?? "",
      reviewId,
    }],
    taskQueue: "light-llm-queue",
  })

  return NextResponse.json({ ok: true, workflowId })
}
