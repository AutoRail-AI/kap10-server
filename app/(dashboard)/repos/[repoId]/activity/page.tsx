import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ActivityFeed } from "@/components/activity/activity-feed"

export default async function ActivityPage(props: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await props.params

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Activity</h1>
        <p className="text-sm text-foreground mt-0.5">
          Timeline of indexing events, entity changes, and cascade re-justifications.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <ActivityFeed repoId={repoId} />
      </Suspense>
    </div>
  )
}
