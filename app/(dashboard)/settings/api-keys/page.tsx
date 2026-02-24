import { redirect } from "next/navigation"
import { getActiveOrgId, getSessionCached } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { ApiKeysSettings } from "./api-keys-settings"

export default async function ApiKeysPage() {
  const session = await getSessionCached()
  if (!session) redirect("/login")

  let orgId: string
  try {
    orgId = await getActiveOrgId()
  } catch {
    redirect("/")
  }

  const container = getContainer()
  const allKeys = await container.relationalStore.listApiKeys(orgId)
  const repos = await container.relationalStore.getRepos(orgId)

  const repoMap = new Map(repos.map((r) => [r.id, r]))

  const keys = allKeys.map((k) => ({
    id: k.id,
    keyPrefix: k.keyPrefix,
    name: k.name,
    repoId: k.repoId,
    repoName: k.repoId ? (repoMap.get(k.repoId)?.fullName ?? k.repoId) : "All repositories",
    scopes: k.scopes,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  }))

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">API Keys</h1>
        <p className="text-sm text-muted-foreground">
          Manage API keys across all repositories in your organization.
        </p>
      </div>

      <ApiKeysSettings initialKeys={keys} />
    </div>
  )
}
