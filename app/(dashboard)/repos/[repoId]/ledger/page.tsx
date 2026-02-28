import { redirect } from "next/navigation"
import { Suspense } from "react"
import { TimelineView } from "@/components/timeline/timeline-view"
import { Skeleton } from "@/components/ui/skeleton"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function LedgerPage({
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
        <h1 className="font-grotesk text-lg font-semibold text-foreground">
          Ledger
        </h1>
        <p className="text-sm text-foreground mt-0.5">
          Every AI-generated change tracked with the prompt that caused it
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <TimelineView repoId={repoId} />
      </Suspense>
    </div>
  )
}
