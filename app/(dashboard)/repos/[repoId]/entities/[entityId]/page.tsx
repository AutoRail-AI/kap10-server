import { redirect } from "next/navigation"

export default async function EntityDetailRedirect({
  params,
}: {
  params: Promise<{ repoId: string; entityId: string }>
}) {
  const { repoId, entityId } = await params
  redirect(`/repos/${repoId}/blueprint/entities/${entityId}`)
}
