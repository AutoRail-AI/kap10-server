import { headers } from "next/headers"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { auth, listOrganizations } from "@/lib/auth"

export default async function SettingsGeneralPage() {
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

  return (
    <div className="space-y-6">
      {/* Organization Name */}
      <Card className="glass-card border-border">
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="space-y-1">
              <h3 className="font-grotesk text-sm font-semibold text-foreground">
                Organization Name
              </h3>
              <p className="text-xs text-muted-foreground">
                This is your organization&apos;s display name.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Input
                className="h-9 max-w-sm"
                defaultValue={activeOrg.name}
                disabled
              />
              <Button size="sm" className="bg-rail-fade hover:opacity-90" disabled>
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Organization Slug */}
      <Card className="glass-card border-border">
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="space-y-1">
              <h3 className="font-grotesk text-sm font-semibold text-foreground">
                Organization Slug
              </h3>
              <p className="text-xs text-muted-foreground">
                Used in URLs and API references.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">kap10.dev/</span>
              <Input
                className="h-9 max-w-xs"
                defaultValue={activeOrg.slug}
                disabled
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="glass-card border-destructive/30">
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="space-y-1">
              <h3 className="font-grotesk text-sm font-semibold text-destructive">
                Danger Zone
              </h3>
              <p className="text-xs text-muted-foreground">
                Permanently delete this organization and all of its data. This action cannot be undone.
              </p>
            </div>
            <Button size="sm" variant="destructive" disabled>
              Delete Organization
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
