import { redirect } from "next/navigation"
import { DriftTimelineView } from "@/components/intelligence/drift-timeline-view"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function DriftPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await getSessionCached()
  if (!session) redirect("/login")

  const { repoId } = await params

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Architectural Drift</h1>
        <p className="text-sm text-foreground mt-0.5">Track semantic changes and intent drift over time</p>
      </div>
      <DriftTimelineView repoId={repoId} />
    </div>
  )
}
