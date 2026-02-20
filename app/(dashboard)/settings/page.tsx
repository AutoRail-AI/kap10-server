import { headers } from "next/headers"
import Link from "next/link"
import { GitBranch } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { auth, listOrganizations } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"

export default async function SettingsPage() {
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

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">
          Organization settings
        </h1>
        <p className="text-sm text-foreground mt-0.5">
          Manage your organization (account context), GitHub connections, and members.
        </p>
      </div>

      <Card className="glass-card border-border">
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-grotesk text-sm font-semibold text-foreground">
                Organization name
              </h3>
              <p className="text-muted-foreground text-sm">
                {activeOrg?.name ?? "—"}
              </p>
            </div>
            <div className="space-y-1">
              <h3 className="font-grotesk text-sm font-semibold text-foreground">
                Members
              </h3>
              <p className="text-muted-foreground text-sm">
                You (owner): {session.user.email}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Link
        href="/settings/connections"
        className="block"
      >
        <Card className="glass-card border-border hover:shadow-glow-purple transition">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted/30">
                  <GitBranch className="h-4 w-4 text-foreground" />
                </div>
                <div className="space-y-0.5">
                  <h3 className="font-grotesk text-sm font-semibold text-foreground">
                    GitHub Connections
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {installations.length === 0
                      ? "No GitHub accounts connected"
                      : `${installations.length} GitHub ${installations.length === 1 ? "account" : "accounts"} connected`}
                  </p>
                </div>
              </div>
              <span className="text-xs text-electric-cyan">Manage &rarr;</span>
            </div>
          </CardContent>
        </Card>
      </Link>

      <Card className="glass-card border-destructive/30">
        <CardContent className="pt-6">
          <div className="space-y-1">
            <h3 className="font-grotesk text-sm font-semibold text-destructive">
              Danger zone
            </h3>
            <p className="text-muted-foreground text-sm">
              Delete organization and all associated data. This cannot be undone.
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Delete organization is available via Better Auth; Phase 0 does not
              implement the button.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
