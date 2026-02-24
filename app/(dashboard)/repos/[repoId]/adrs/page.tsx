import { redirect } from "next/navigation"
import { Suspense } from "react"
import { AdrView } from "@/components/adrs/adr-view"
import { Skeleton } from "@/components/ui/skeleton"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function AdrsPage({
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
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Architecture Decisions</h1>
        <p className="text-sm text-foreground mt-0.5">Auto-generated architecture decision records from codebase analysis</p>
      </div>
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <AdrView repoId={repoId} />
      </Suspense>
    </div>
  )
}
