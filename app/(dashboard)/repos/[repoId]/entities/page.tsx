import { redirect } from "next/navigation"
import { Suspense } from "react"
import { EntityBrowseView } from "@/components/entity/entity-browse-view"
import { Skeleton } from "@/components/ui/skeleton"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function EntitiesPage({
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
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Entities</h1>
        <p className="text-sm text-foreground mt-0.5">Browse all code entities with business justifications</p>
      </div>
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <EntityBrowseView repoId={repoId} />
      </Suspense>
    </div>
  )
}
