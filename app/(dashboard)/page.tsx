import { headers } from "next/headers"
import { Suspense } from "react"
import { CreateWorkspaceFirstBanner } from "@/components/dashboard/create-workspace-first-banner"
import { EmptyStateNoOrg } from "@/components/dashboard/empty-state-no-org"
import { EmptyStateRepos } from "@/components/dashboard/empty-state-repos"
import { ReposList } from "@/components/dashboard/repos-list"
import { Skeleton } from "@/components/ui/skeleton"
import { auth, listOrganizations } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"

async function DashboardContent() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null

  let organizations: { id: string }[] = []
  try {
    organizations = await listOrganizations(await headers())
  } catch {
    return <EmptyStateNoOrg />
  }

  const activeOrgId = organizations[0]?.id
  if (!activeOrgId) return <EmptyStateNoOrg />

  const container = getContainer()
  const [repos, installation] = await Promise.all([
    container.relationalStore.getRepos(activeOrgId),
    container.relationalStore.getInstallation(activeOrgId),
  ])

  if (repos.length === 0 && !installation) {
    return (
      <EmptyStateRepos installHref={`/api/github/install?orgId=${encodeURIComponent(activeOrgId)}`} />
    )
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">
            Repositories
          </h1>
          <p className="text-sm text-foreground mt-0.5">
            Connect and manage your repositories for code intelligence.
            {installation?.accountLogin != null && (
              <span className="ml-1.5 text-muted-foreground">
                (GitHub: @{installation.accountLogin})
              </span>
            )}
          </p>
        </div>
      </div>
      <ReposList
        repos={repos}
        hasInstallation={installation != null}
        githubAccountLogin={installation?.accountLogin ?? null}
        installHref={`/api/github/install?orgId=${encodeURIComponent(activeOrgId)}`}
      />
    </>
  )
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      {params.error === "create_workspace_first" && (
        <CreateWorkspaceFirstBanner />
      )}
      <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
        <DashboardContent />
      </Suspense>
    </div>
  )
}
