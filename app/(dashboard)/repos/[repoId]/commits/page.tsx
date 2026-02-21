import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { CommitsView } from "@/components/timeline/commits-view"

export default async function CommitsPage(props: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await props.params

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Commits</h1>
        <p className="text-sm text-foreground mt-0.5">
          AI contribution summaries per commit
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <CommitsView repoId={repoId} />
      </Suspense>
    </div>
  )
}
