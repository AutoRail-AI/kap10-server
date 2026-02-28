import { redirect } from "next/navigation"
import { Suspense } from "react"
import { GlossaryView } from "@/components/glossary/glossary-view"
import { IntelligenceView } from "@/components/intelligence/intelligence-view"
import { Skeleton } from "@/components/ui/skeleton"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function IntelligencePage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await getSessionCached()
  if (!session) redirect("/login")

  const { repoId } = await params

  return (
    <div className="space-y-8 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Code Intelligence</h1>
        <p className="text-sm text-foreground mt-0.5">Cruft detection, pattern alignment, and domain vocabulary</p>
      </div>
      <IntelligenceView repoId={repoId} />

      {/* Domain Glossary subsection */}
      <section className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk">
          Domain Glossary
        </p>
        <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
          <GlossaryView repoId={repoId} />
        </Suspense>
      </section>
    </div>
  )
}
