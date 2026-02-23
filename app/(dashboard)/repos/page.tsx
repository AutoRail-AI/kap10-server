import { headers } from "next/headers"
import { Suspense } from "react"
import { EmptyStateRepos } from "@/components/dashboard/empty-state-repos"
import { ReposList } from "@/components/dashboard/repos-list"
import { Skeleton } from "@/components/ui/skeleton"
import { auth, listOrganizations } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"

async function ReposContent() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null

  let organizations: { id: string }[] = []
  try {
    organizations = await listOrganizations(await headers())
  } catch {
    return <EmptyStateRepos />
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

  if (repos.length === 0 && installations.length === 0) {
    return (
      <EmptyStateRepos installHref={`/api/github/install?orgId=${encodeURIComponent(activeOrgId)}`} />
    )
  }

  const githubAccounts = installations.map((i) => ({
    login: i.accountLogin,
    type: i.accountType,
  }))

  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">
            Repositories
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Connect and manage your repositories for code intelligence.
          </p>
        </div>
      </div>
      <ReposList
        repos={repos}
        hasInstallation={installations.length > 0}
        githubAccounts={githubAccounts}
        installHref={`/api/github/install?orgId=${encodeURIComponent(activeOrgId)}`}
      />
    </>
  )
}

export default async function ReposPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      {params.error === "no_org_context" && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
        >
          <p>
            Could not link GitHub. Please ensure you have an active organization
            selected, then try connecting GitHub again.
          </p>
        </div>
      )}
      <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
        <ReposContent />
      </Suspense>
    </div>
  )
}
