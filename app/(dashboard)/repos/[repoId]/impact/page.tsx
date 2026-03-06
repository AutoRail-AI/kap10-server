import { redirect } from "next/navigation"

export default async function ImpactRedirect({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  redirect(`/repos/${repoId}/blueprint/impact`)
}
