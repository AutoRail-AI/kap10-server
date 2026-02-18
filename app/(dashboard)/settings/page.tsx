import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { auth, listOrganizations } from "@/lib/auth"

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

  if (organizations.length === 0) {
    redirect("/")
  }

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">
          Organization settings
        </h1>
        <p className="text-sm text-foreground mt-0.5">
          Manage your organization name and members.
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

      <Card className="glass-card border-border border-destructive/30">
        <CardContent className="pt-6">
          <div className="space-y-1">
            <h3 className="font-grotesk text-sm font-semibold text-destructive">
              Danger zone
            </h3>
            <p className="text-muted-foreground text-sm">
              Delete organization and all associated data. This cannot be undone.
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Delete org is available via Better Auth; Phase 0 does not implement
              the button.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
