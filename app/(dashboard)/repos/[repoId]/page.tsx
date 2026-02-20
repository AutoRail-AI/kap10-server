import { headers } from "next/headers"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { ChevronRight, FileCode, GitBranch, Layers } from "lucide-react"
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
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) notFound()

  if (repo.status !== "ready") {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <nav className="flex items-center gap-1.5 text-sm">
            <Link href="/repos" className="text-muted-foreground hover:text-foreground transition-colors">
              Repositories
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-foreground font-medium">{repo.name}</span>
          </nav>
          <p className="text-sm text-muted-foreground">{repo.fullName}</p>
        </div>
        <div className="glass-card border-border rounded-lg border p-6 text-center">
          <p className="text-muted-foreground text-sm">
            This repository is not ready for browsing yet.
          </p>
          <p className="text-muted-foreground text-xs mt-1">
            Status: <span className="text-foreground font-medium">{repo.status}</span>
            {repo.status === "indexing" && ` · Progress: ${repo.indexProgress ?? 0}%`}
          </p>
          {repo.errorMessage && (
            <p className="text-destructive text-xs mt-2">{repo.errorMessage}</p>
          )}
        </div>
      </div>
    )
  }

  const paths = await container.graphStore.getFilePaths(orgId, repoId)
  const tree = buildFileTree(paths)

  return (
    <div className="space-y-4">
      {/* Breadcrumb + stats */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <nav className="flex items-center gap-1.5 text-sm">
            <Link href="/repos" className="text-muted-foreground hover:text-foreground transition-colors">
              Repositories
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-foreground font-medium">{repo.name}</span>
          </nav>
          <p className="text-sm text-muted-foreground">{repo.fullName}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2.5 py-1">
            <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{repo.fileCount ?? 0} files</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2.5 py-1">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{(repo.functionCount ?? 0) + (repo.classCount ?? 0)} entities</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2.5 py-1">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{repo.defaultBranch ?? "main"}</span>
          </div>
        </div>
      </div>

      {/* File tree + entities + detail panels */}
      {paths.length > 0 ? (
        <RepoDetailClient repoId={repoId} repoName={repo.name} initialTree={tree} orgId={orgId} />
      ) : (
        <div className="glass-card border-border rounded-lg border p-6 text-center">
          <p className="text-muted-foreground text-sm">
            No files indexed yet. The indexing may have completed but no file entities were stored.
          </p>
          <p className="text-muted-foreground text-xs mt-1">
            Try re-indexing from the dashboard.
          </p>
        </div>
      )}
    </div>
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
