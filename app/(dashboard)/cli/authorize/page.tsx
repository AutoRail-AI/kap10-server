import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth, listOrganizations } from "@/lib/auth"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { CliAuthorizeForm } from "./cli-authorize-form"

export default async function CliAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session) redirect("/login?callbackUrl=/cli/authorize")

  let orgId: string
  let orgName: string
  try {
    orgId = await getActiveOrgId()
    const memberOrgs = await listOrganizations(reqHeaders)
    orgName = memberOrgs.find((o) => o.id === orgId)?.name ?? "your organization"
  } catch {
    redirect("/")
  }

  const { code } = await searchParams
  if (!code) {
    return (
      <div className="space-y-6 py-6 animate-fade-in">
        <div className="space-y-1">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">
            Authorize CLI
          </h1>
          <p className="text-sm text-muted-foreground">
            No authorization code provided. Run <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">kap10 auth login</code> in your terminal to start.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">
          Authorize CLI
        </h1>
        <p className="text-sm text-muted-foreground">
          Confirm that this code matches what you see in your terminal
        </p>
      </div>

      <CliAuthorizeForm
        userCode={code}
        orgId={orgId}
        orgName={orgName}
        userName={session.user.name ?? session.user.email}
      />
    </div>
  )
}
