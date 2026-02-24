import { Activity, Database, FileCode, Shield } from "lucide-react"
import { Suspense } from "react"
import { CliHero } from "@/components/dashboard/cli-hero"
import { OverviewAddRepoCard } from "@/components/dashboard/overview-add-repo-card"
import { OverviewRepoCard } from "@/components/dashboard/overview-repo-card"
import { StatCard } from "@/components/dashboard/overview-stats"
import { Skeleton } from "@/components/ui/skeleton"
import { getSessionCached, getOrgsCached } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"

async function OverviewContent() {
  const session = await getSessionCached()
  if (!session) return null

  const organizations = await getOrgsCached()
  const activeOrg = organizations[0]
  const activeOrgId = activeOrg?.id
  const activeOrgName = activeOrg?.name ?? "your organization"
  if (!activeOrgId) {
    throw new Error(
      "No active organization found. Every user should have an auto-provisioned organization."
    )
  }

  const container = getContainer()
  const [repos, activeRules, detectedPatterns] = await Promise.all([
    container.relationalStore.getRepos(activeOrgId),
    container.graphStore
      .queryRules(activeOrgId, { orgId: activeOrgId, status: "active", limit: 100 })
      .catch(() => []),
    container.graphStore
      .queryPatterns(activeOrgId, { orgId: activeOrgId, limit: 100 })
      .catch(() => []),
  ])

  const installHref = `/api/github/install?orgId=${encodeURIComponent(activeOrgId)}`

  // Calculate aggregated stats
  const totalFiles = repos.reduce((sum, r) => sum + (r.fileCount ?? 0), 0)
  const totalEntities = repos.reduce(
    (sum, r) => sum + (r.functionCount ?? 0) + (r.classCount ?? 0),
    0
  )

  return (
    <>
      {/* Platform Intelligence Stats */}
      <div className="space-y-4">
        <h2 className="font-grotesk text-sm font-semibold text-foreground">
          Platform Usage
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Repositories"
            value={repos.length}
            detail={`${repos.filter((r) => r.status === "ready").length} Active`}
            icon={Database}
          />
          <StatCard
            label="Code Intelligence"
            value={totalEntities.toLocaleString()}
            detail="Functions & Classes Indexed"
            icon={FileCode}
          />
          <StatCard
            label="Governance"
            value={activeRules.length}
            detail="Active Rules"
            icon={Shield}
          />
          <StatCard
            label="Intelligence"
            value={detectedPatterns.length}
            detail="Patterns Detected"
            icon={Activity}
          />
        </div>
      </div>

      {/* Active State: Connected Repositories */}
      <div className="space-y-4">
        <h2 className="font-grotesk text-sm font-semibold text-foreground">
          Repositories in {activeOrgName}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {repos.map((repo) => (
            <OverviewRepoCard key={repo.id} repo={repo} />
          ))}
        </div>
      </div>

      {/* Onboarding Zone: CLI & Connect UI */}
      <div className="grid gap-6 lg:grid-cols-2">
        <CliHero />
        <OverviewAddRepoCard installHref={installHref} orgName={activeOrgName} />
      </div>
    </>
  )
}

export default async function OverviewPage() {
  return (
    <div className="space-y-6 py-6 animate-fade-in bg-[#0A0A0F]">
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <OverviewContent />
      </Suspense>
    </div>
  )
}
