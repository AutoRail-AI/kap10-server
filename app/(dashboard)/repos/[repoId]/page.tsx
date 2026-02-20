import { headers } from "next/headers"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { ChevronRight, Download, FileCode, GitBranch, Layers, Plug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RepoDetailClient } from "@/components/repo/repo-detail-client"
import { McpStatus } from "@/components/repo/mcp-status"
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

  // Fetch snapshot metadata for local sync status
  let snapshot: { status: string; sizeBytes: number; entityCount: number; edgeCount: number; generatedAt: Date | null } | null = null
  try {
    const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client")
    const prisma = new PrismaClient()
    const meta = await prisma.graphSnapshotMeta.findUnique({ where: { repoId } })
    if (meta) {
      snapshot = { status: meta.status, sizeBytes: meta.sizeBytes, entityCount: meta.entityCount, edgeCount: meta.edgeCount, generatedAt: meta.generatedAt }
    }
    await prisma.$disconnect()
  } catch {
    // Snapshot metadata not available — non-critical
  }

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
          <McpStatus repoId={repoId} />
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
          {snapshot && snapshot.status === "available" && (
            <div className="flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/5 px-2.5 py-1">
              <Download className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-400">
                Local Sync · {(snapshot.sizeBytes / 1024).toFixed(0)}KB
              </span>
            </div>
          )}
          <Link href={`/repos/${repoId}/connect`}>
            <Button size="sm" className="bg-rail-fade hover:opacity-90 gap-1.5 h-7 text-xs">
              <Plug className="h-3 w-3" />
              Connect to IDE
            </Button>
          </Link>
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
