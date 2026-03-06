import { redirect } from "next/navigation"

export default async function RulesRedirect({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  redirect(`/repos/${repoId}/guardrails`)
}
