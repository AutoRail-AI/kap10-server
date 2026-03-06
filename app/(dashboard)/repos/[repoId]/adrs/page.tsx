import { redirect } from "next/navigation"

export default async function AdrsRedirect({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  redirect(`/repos/${repoId}/guardrails/decisions`)
}
