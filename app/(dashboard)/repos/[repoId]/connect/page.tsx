import { ChevronRight } from "lucide-react"
import { headers } from "next/headers"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ConnectIde } from "@/components/repo/connect-ide"
import { LocalSetupInstructions } from "@/components/repo/local-setup-instructions"
import { auth } from "@/lib/auth"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"

export default async function ConnectIdePage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  const { repoId } = await params
  let orgId: string
  try {
    orgId = await getActiveOrgId()
  } catch {
    redirect("/")
  }

  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) notFound()

  if (repo.status !== "ready") {
    redirect(`/repos/${repoId}`)
  }

  // Fetch API keys for this repo
  const allKeys = await container.relationalStore.listApiKeys(orgId, repoId)
  const apiKeys = allKeys.map((k) => ({
    id: k.id,
    keyPrefix: k.keyPrefix,
    name: k.name,
    scopes: k.scopes,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  }))

  const mcpServerUrl = process.env.MCP_SERVER_URL ?? "https://mcp.kap10.dev"

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/repos" className="hover:text-foreground transition-colors">
          Repositories
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/repos/${repoId}`} className="hover:text-foreground transition-colors">
          {repo.name}
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Connect to IDE</span>
      </nav>

      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">
          Connect to IDE
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect {repo.fullName} to your AI coding agent via MCP
        </p>
      </div>

      {/* Connection component */}
      <ConnectIde
        repoId={repoId}
        repoName={repo.fullName}
        mcpServerUrl={mcpServerUrl}
        apiKeys={apiKeys}
      />

      {/* Local-first setup */}
      <div className="space-y-1 pt-2">
        <h2 className="font-grotesk text-base font-semibold text-foreground">
          Local-First Mode
        </h2>
        <p className="text-sm text-muted-foreground">
          Run graph queries locally with sub-5ms latency using the kap10 CLI
        </p>
      </div>
      <LocalSetupInstructions
        repoId={repoId}
        repoName={repo.fullName}
        serverUrl={mcpServerUrl}
      />
    </div>
  )
}
