import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { GlossaryView } from "@/components/glossary/glossary-view"
import { Skeleton } from "@/components/ui/skeleton"
import { auth } from "@/lib/auth"

export default async function GlossaryPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  const { repoId } = await params

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Domain Glossary</h1>
        <p className="text-sm text-foreground mt-0.5">Domain vocabulary and ubiquitous language extracted from your codebase</p>
      </div>
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <GlossaryView repoId={repoId} />
      </Suspense>
    </div>
  )
}
