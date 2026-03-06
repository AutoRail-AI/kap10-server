import { redirect } from "next/navigation"
import { Suspense } from "react"
import { GlossaryView } from "@/components/glossary/glossary-view"
import { Skeleton } from "@/components/ui/skeleton"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function IntelligenceGlossaryPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await getSessionCached()
  if (!session) redirect("/login")

  const { repoId } = await params

  return (
    <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
      <GlossaryView repoId={repoId} />
    </Suspense>
  )
}
