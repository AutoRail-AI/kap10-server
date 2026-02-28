import { FileCode } from "lucide-react"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { AnnotatedCodeViewer } from "@/components/code/annotated-code-viewer"
import { RepoOnboardingConsole } from "@/components/repo/repo-onboarding-console"
import { Skeleton } from "@/components/ui/skeleton"
import { getActiveOrgId, getSessionCached } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { buildFileTree } from "@/lib/utils/file-tree-builder"

async function CodeTabContent({ repoId }: { repoId: string }) {
  const session = await getSessionCached()
  if (!session) return null

  const orgId = await getActiveOrgId()
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) notFound()

  if (repo.status !== "ready") {
    return (
      <RepoOnboardingConsole
        repoId={repoId}
        initialStatus={repo.status}
        initialProgress={repo.indexProgress ?? 0}
        repoName={repo.name}
        fullName={repo.fullName ?? repo.name}
        errorMessage={repo.errorMessage}
      />
    )
  }

  const paths = await container.graphStore.getFilePaths(orgId, repoId)
  const tree = buildFileTree(paths)

  return (
    <div className="animate-fade-in">
      {paths.length > 0 ? (
        <AnnotatedCodeViewer repoId={repoId} initialTree={tree} />
      ) : (
        <div className="rounded-lg border border-white/10 p-12 text-center">
          <FileCode className="mx-auto h-10 w-10 text-white/10 mb-4" />
          <p className="font-grotesk text-sm font-semibold text-foreground">
            No files indexed
          </p>
          <p className="text-xs text-white/40 mt-1">
            The indexing pipeline completed but no file entities were stored. Try
            re-indexing from the Pipeline tab.
          </p>
        </div>
      )}
    </div>
  )
}

export default async function RepoCodePage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  return (
    <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
      <CodeTabContent repoId={repoId} />
    </Suspense>
  )
}
