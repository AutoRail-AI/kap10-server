import { redirect } from "next/navigation"
import { Suspense } from "react"
import { EntityBrowseView } from "@/components/entity/entity-browse-view"
import { Skeleton } from "@/components/ui/skeleton"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function BlueprintEntitiesPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await getSessionCached()
  if (!session) redirect("/login")

  const { repoId } = await params

  return (
    <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
      <EntityBrowseView repoId={repoId} />
    </Suspense>
  )
}
