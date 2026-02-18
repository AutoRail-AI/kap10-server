import { headers } from "next/headers"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { RepoDetailClient } from "@/components/repo/repo-detail-client"
import { Skeleton } from "@/components/ui/skeleton"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { auth } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"
import { buildFileTree } from "@/lib/utils/file-tree-builder"

async function RepoDetailContent({ repoId }: { repoId: string }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null
  const orgId = await getActiveOrgId()
  if (!orgId) return null
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) notFound()
  if (repo.status !== "ready") {
    return (
      <div className="space-y-6 py-6">
        <p className="text-muted-foreground text-sm">This repository is not ready for browsing yet. Status: {repo.status}</p>
        <Link href="/repos" className="text-electric-cyan text-sm hover:underline">Back to Repositories</Link>
      </div>
    )
  }
  const paths = await container.graphStore.getFilePaths(orgId, repoId)
  const tree = buildFileTree(paths)
  return (
    <RepoDetailClient repoId={repoId} repoName={repo.name} initialTree={tree} orgId={orgId} />
  )
}

export default async function RepoDetailPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <RepoDetailContent repoId={repoId} />
      </Suspense>
    </div>
  )
}
