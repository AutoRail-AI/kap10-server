import { redirect } from "next/navigation"
import { IntelligenceView } from "@/components/intelligence/intelligence-view"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function IntelligencePage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await getSessionCached()
  if (!session) redirect("/login")

  const { repoId } = await params

  return <IntelligenceView repoId={repoId} />
}
