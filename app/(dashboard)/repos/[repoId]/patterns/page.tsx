import { redirect } from "next/navigation"

export default async function PatternsRedirect({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  redirect(`/repos/${repoId}/blueprint/patterns`)
}
