import { redirect } from "next/navigation"

export default async function GlossaryRedirect({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  redirect(`/repos/${repoId}/intelligence/glossary`)
}
