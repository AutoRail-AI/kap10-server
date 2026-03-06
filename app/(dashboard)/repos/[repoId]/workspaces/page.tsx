import { GitBranch, Monitor, Clock, Hash } from "lucide-react"
import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { getActiveOrgId, getSessionCached } from "@/lib/api/get-active-org"

async function WorkspaceSyncList({ repoId }: { repoId: string }) {
  const session = await getSessionCached()
  if (!session) return null

  const orgId = await getActiveOrgId()
  const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
  const prisma = getPrisma()

  const [syncs, branches] = await Promise.all([
    prisma.workspaceSync.findMany({
      where: { orgId, repoId },
      orderBy: { syncedAt: "desc" },
      take: 50,
    }),
    prisma.branchRef.findMany({
      where: { orgId, repoId },
      orderBy: { updatedAt: "desc" },
    }),
  ])

  // Group syncs by userId
  const syncsByUser = new Map<string, typeof syncs>()
  for (const sync of syncs) {
    const existing = syncsByUser.get(sync.userId) ?? []
    existing.push(sync)
    syncsByUser.set(sync.userId, existing)
  }

  return (
    <div className="space-y-6">
      {/* Branch Refs */}
      <div className="space-y-3">
        <h2 className="font-grotesk text-sm font-semibold text-foreground flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-electric-cyan" />
          Tracked Branches
        </h2>
        {branches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No branches tracked yet. Enable branch tracking in settings to index non-default branches.</p>
        ) : (
          <div className="grid gap-2">
            {branches.map((branch) => (
              <div key={branch.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/2 px-4 py-3">
                <div className="flex items-center gap-3">
                  <GitBranch className="h-3.5 w-3.5 text-white/40" />
                  <span className="font-mono text-sm text-foreground">{branch.branchName}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Hash className="h-3 w-3" />
                    {branch.headSha.slice(0, 8)}
                  </span>
                  {branch.lastIndexedAt && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatAge(branch.lastIndexedAt)}
                    </span>
                  )}
                  {branch.lastIndexedSha && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      branch.lastIndexedSha === branch.headSha
                        ? "border border-emerald-400/30 bg-emerald-400/5 text-emerald-400"
                        : "border border-warning/30 bg-warning/5 text-warning"
                    }`}>
                      {branch.lastIndexedSha === branch.headSha ? "Indexed" : "Stale"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workspace Syncs */}
      <div className="space-y-3">
        <h2 className="font-grotesk text-sm font-semibold text-foreground flex items-center gap-2">
          <Monitor className="h-4 w-4 text-electric-cyan" />
          Active Workspaces
        </h2>
        {syncsByUser.size === 0 ? (
          <p className="text-sm text-muted-foreground">No workspace syncs yet. Run <code className="font-mono text-xs bg-white/5 px-1.5 py-0.5 rounded">unerr sync</code> from your local repo to start.</p>
        ) : (
          <div className="grid gap-2">
            {Array.from(syncsByUser.entries()).map(([userId, userSyncs]) => {
              const latest = userSyncs[0]!
              return (
                <div key={userId} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/2 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Monitor className="h-3.5 w-3.5 text-white/40" />
                    <div>
                      <span className="font-mono text-sm text-foreground">{userId.slice(0, 8)}...</span>
                      <span className="ml-2 text-xs text-muted-foreground">{userSyncs.length} sync{userSyncs.length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Hash className="h-3 w-3" />
                      {latest.commitSha.slice(0, 8)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatAge(latest.syncedAt)}
                    </span>
                    {latest.fileCount > 0 && (
                      <span className="text-[10px]">{latest.fileCount} files</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function formatAge(date: Date): string {
  const ms = Date.now() - new Date(date).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default async function WorkspacesPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Workspaces</h1>
        <p className="text-sm text-foreground mt-0.5">Active workspace syncs and tracked branches for this repository.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
        <WorkspaceSyncList repoId={repoId} />
      </Suspense>
    </div>
  )
}
