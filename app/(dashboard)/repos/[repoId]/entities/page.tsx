import { redirect } from "next/navigation"

export default async function EntitiesRedirect({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  redirect(`/repos/${repoId}/blueprint/entities`)
}
