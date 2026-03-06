import { redirect } from "next/navigation"
import { DriftTimelineView } from "@/components/intelligence/drift-timeline-view"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function IntelligenceDriftPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await getSessionCached()
  if (!session) redirect("/login")

  const { repoId } = await params

  return <DriftTimelineView repoId={repoId} />
}
