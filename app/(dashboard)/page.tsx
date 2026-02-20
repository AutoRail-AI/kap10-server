import { headers } from "next/headers"
import Link from "next/link"
import { Suspense } from "react"
import { ArrowRight, FileCode, FolderGit2, GitBranch, Layers, Plus, Settings } from "lucide-react"
import { QuickActionCard, RepoRowCompact, StatCard } from "@/components/dashboard/overview-stats"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { auth, listOrganizations } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"

async function OverviewContent() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null

  let organizations: { id: string }[] = []
  try {
    organizations = await listOrganizations(await headers())
  } catch {
    organizations = []
  }

  const activeOrgId = organizations[0]?.id
  if (!activeOrgId) {
    throw new Error("No active organization found. Every user should have an auto-provisioned organization.")
  }

  const container = getContainer()
  const [repos, installations] = await Promise.all([
    container.relationalStore.getRepos(activeOrgId),
    container.relationalStore.getInstallations(activeOrgId),
  ])

  const totalFiles = repos.reduce((sum: number, r) => sum + (r.fileCount ?? 0), 0)
  const totalEntities = repos.reduce((sum: number, r) => sum + (r.functionCount ?? 0) + (r.classCount ?? 0), 0)
  const totalConnections = installations.length
  const recentRepos = repos.slice(0, 5)

  return (
    <>
      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Repositories"
          value={repos.length}
          detail={`${repos.filter((r) => r.status === "ready").length} indexed`}
          icon={FolderGit2}
        />
        <StatCard
          label="Files Indexed"
          value={totalFiles.toLocaleString()}
          detail="Across all repos"
          icon={FileCode}
        />
        <StatCard
          label="Entities"
          value={totalEntities.toLocaleString()}
          detail="Functions & classes"
          icon={Layers}
        />
        <StatCard
          label="Connections"
          value={totalConnections}
          detail={`GitHub ${totalConnections === 1 ? "account" : "accounts"}`}
          icon={GitBranch}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Repositories */}
        <Card className="glass-card border-border lg:col-span-2">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-grotesk text-sm font-semibold text-foreground">Recent Repositories</h2>
              <Link href="/repos" className="text-xs text-electric-cyan hover:underline flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {recentRepos.length > 0 ? (
              <div className="-mx-3 divide-y divide-border">
                {recentRepos.map((repo) => (
                  <RepoRowCompact key={repo.id} repo={repo} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No repositories yet. Connect GitHub to get started.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="space-y-3">
          <h2 className="font-grotesk text-sm font-semibold text-foreground">Quick Actions</h2>
          <QuickActionCard
            icon={Plus}
            title="Add Repository"
            description="Connect repos from GitHub"
            href="/repos"
          />
          <QuickActionCard
            icon={GitBranch}
            title="Manage Connections"
            description="GitHub accounts & orgs"
            href="/settings/connections"
          />
          <QuickActionCard
            icon={Settings}
            title="Org Settings"
            description="Members & configuration"
            href="/settings"
          />
        </div>
      </div>
    </>
  )
}

export default async function OverviewPage() {
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Overview</h1>
        <p className="text-sm text-foreground mt-0.5">
          Your code intelligence platform at a glance.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <OverviewContent />
      </Suspense>
    </div>
  )
}
