import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { IssuesView } from "@/components/issues/issues-view"

export default async function RepoIssuesPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">
          Issues
        </h1>
        <p className="text-sm text-foreground mt-0.5">
          Prioritized issues with reasoning, impact analysis, and agent-ready fix prompts.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <IssuesView repoId={repoId} />
      </Suspense>
    </div>
  )
}
