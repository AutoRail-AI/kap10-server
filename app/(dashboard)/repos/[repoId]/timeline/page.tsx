import { Suspense } from "react"
import { TimelineView } from "@/components/timeline/timeline-view"
import { Skeleton } from "@/components/ui/skeleton"

export default async function TimelinePage(props: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await props.params

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Timeline</h1>
        <p className="text-sm text-foreground mt-0.5">
          Chronological log of AI-assisted changes
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <TimelineView repoId={repoId} />
      </Suspense>
    </div>
  )
}
