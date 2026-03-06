import { redirect } from "next/navigation"

export default async function ReviewsRedirect({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  redirect(`/repos/${repoId}/guardrails/reviews`)
}
