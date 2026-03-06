import { redirect } from "next/navigation"

export default async function NewRuleRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { repoId } = await params
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value)
  }
  const query = qs.toString()
  redirect(`/repos/${repoId}/guardrails/new${query ? `?${query}` : ""}`)
}
