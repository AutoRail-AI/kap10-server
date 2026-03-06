import { Clock, GitBranch, Hash, Star } from "lucide-react"
import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { getActiveOrgId, getSessionCached } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"

async function BranchList({ repoId }: { repoId: string }) {
  const session = await getSessionCached()
  if (!session) return null

  const orgId = await getActiveOrgId()
  const container = getContainer()

  const [repo, branches] = await Promise.all([
    container.relationalStore.getRepo(orgId, repoId),
    (async () => {
      const { getPrisma } = require("@/lib/db/prisma") as typeof import("@/lib/db/prisma")
      const prisma = getPrisma()
      return prisma.branchRef.findMany({
        where: { orgId, repoId },
        orderBy: { updatedAt: "desc" },
      })
    })(),
  ])

  if (!repo) return null

  return (
    <div className="space-y-4">
      {/* Primary branch — always shown */}
      <div className="flex items-center justify-between rounded-lg border border-electric-cyan/20 bg-electric-cyan/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <Star className="h-3.5 w-3.5 text-electric-cyan" />
          <span className="font-mono text-sm font-semibold text-foreground">
            {repo.defaultBranch ?? "main"}
          </span>
          <span className="rounded-full border border-electric-cyan/30 bg-electric-cyan/10 px-2 py-0.5 text-[10px] font-medium text-electric-cyan">
            Primary
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {repo.lastIndexedSha && (
            <span className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              {repo.lastIndexedSha.slice(0, 8)}
            </span>
          )}
          {repo.lastIndexedAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatAge(repo.lastIndexedAt)}
            </span>
          )}
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/5 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
            Indexed
          </span>
        </div>
      </div>

      {/* Tracked branches */}
      {branches.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/2 px-4 py-8 text-center">
          <GitBranch className="mx-auto h-8 w-8 text-white/20 mb-3" />
          <p className="text-sm text-muted-foreground">No additional branches tracked.</p>
          <p className="text-xs text-white/30 mt-1">
            Enable branch tracking in repository settings, then push to a non-default branch on GitHub to start indexing.
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {branches.map((branch) => {
            const isIndexed = !!branch.lastIndexedSha
            const isStale = isIndexed && branch.lastIndexedSha !== branch.headSha

            return (
              <div
                key={branch.id}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/2 px-4 py-3"
              >
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
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      !isIndexed
                        ? "border border-white/10 bg-white/5 text-white/40"
                        : isStale
                          ? "border border-warning/30 bg-warning/5 text-warning"
                          : "border border-emerald-400/30 bg-emerald-400/5 text-emerald-400"
                    }`}
                  >
                    {!isIndexed ? "Pending" : isStale ? "Stale" : "Indexed"}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatAge(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default async function BranchesPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Branches</h1>
        <p className="text-sm text-foreground mt-0.5">
          Indexed branches and their current status. The primary branch is always indexed.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
        <BranchList repoId={repoId} />
      </Suspense>
    </div>
  )
}
