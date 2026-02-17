import { headers } from "next/headers"
import { Suspense } from "react"
import { EmptyStateRepos } from "@/components/dashboard/empty-state-repos"
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
  if (!activeOrgId) return <EmptyStateRepos />

  const container = getContainer()
  const repos = await container.relationalStore.getRepos(activeOrgId)

  if (repos.length === 0) {
    return <EmptyStateRepos />
  }

  return (
    <div className="space-y-4">
      {repos.map((repo) => (
        <div
          key={repo.id}
          className="glass-card border-border flex items-center justify-between rounded-lg border p-4"
        >
          <div>
            <p className="font-grotesk text-sm font-semibold text-foreground">
              {repo.name}
            </p>
            <p className="text-muted-foreground text-xs">{repo.fullName}</p>
          </div>
          <span className="text-muted-foreground text-xs">{repo.status}</span>
        </div>
      ))}
    </div>
  )
}

export default function ReposPage() {
  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">
          Repositories
        </h1>
        <p className="text-sm text-foreground mt-0.5">
          Manage connected repositories.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
        <ReposContent />
      </Suspense>
    </div>
  )
}
