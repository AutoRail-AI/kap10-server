import { redirect } from "next/navigation"

export default async function DriftRedirect({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  redirect(`/repos/${repoId}/intelligence/drift`)
}
