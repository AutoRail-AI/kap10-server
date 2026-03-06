import { redirect } from "next/navigation"

export default async function ReviewDetailRedirect({
  params,
}: {
  params: Promise<{ repoId: string; reviewId: string }>
}) {
  const { repoId, reviewId } = await params
  redirect(`/repos/${repoId}/guardrails/reviews/${reviewId}`)
}
