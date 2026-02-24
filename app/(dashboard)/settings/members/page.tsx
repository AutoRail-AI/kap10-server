import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getSessionCached } from "@/lib/api/get-active-org"

export default async function MembersPage() {
  const session = await getSessionCached()
  if (!session) return null

  const user = session.user

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-grotesk text-sm font-semibold text-foreground">Team Members</h2>
        <Button size="sm" className="bg-rail-fade hover:opacity-90" disabled>
          Invite Member
        </Button>
      </div>
      <Card className="glass-card border-border">
        <CardContent className="pt-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Member</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium text-right">Joined</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border last:border-0">
                <td className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted/30">
                      <span className="text-xs font-medium text-foreground">
                        {(user.name ?? user.email)?.[0]?.toUpperCase() ?? "?"}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{user.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="py-3">
                  <Badge variant="outline" className="text-xs">Owner</Badge>
                </td>
                <td className="py-3 text-right text-xs text-muted-foreground">
                  {(user as Record<string, unknown>).createdAt
                    ? new Date((user as Record<string, unknown>).createdAt as string).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
