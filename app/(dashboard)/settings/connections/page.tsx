import { headers } from "next/headers"
import { Suspense } from "react"
import { GitHubConnectionsList } from "@/components/dashboard/github-connections-list"
import { Skeleton } from "@/components/ui/skeleton"
import { auth, listOrganizations } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"

async function ConnectionsContent() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null

  let organizations: { id: string; name: string; slug: string }[] = []
  try {
    organizations = await listOrganizations(await headers())
  } catch {
    organizations = []
  }

  const activeOrg = organizations[0]
  if (!activeOrg) {
    throw new Error("No active organization found. Every user should have an auto-provisioned organization.")
  }

  const container = getContainer()
  const installations = await container.relationalStore.getInstallations(activeOrg.id)
  const repos = await container.relationalStore.getRepos(activeOrg.id)

  const connections = installations.map((inst) => ({
    id: inst.id,
    installationId: inst.installationId,
    accountLogin: inst.accountLogin,
    accountType: inst.accountType,
    createdAt: inst.createdAt.toISOString(),
    repoCount: repos.filter((r) =>
      r.githubFullName?.startsWith(`${inst.accountLogin}/`)
    ).length,
  }))

  return (
    <GitHubConnectionsList
      connections={connections}
      orgId={activeOrg.id}
      orgName={activeOrg.name}
    />
  )
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
      <ConnectionsContent />
    </Suspense>
  )
}
