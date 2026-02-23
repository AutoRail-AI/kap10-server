import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { DashboardAccountProvider } from "@/components/dashboard/dashboard-account-provider"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { DashboardNav } from "@/components/dashboard/dashboard-nav"
import { UserProfileMenu } from "@/components/dashboard/user-profile-menu"
import { auth, listOrganizations } from "@/lib/auth"
import { getContainer } from "@/lib/di/container"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session) {
    redirect("/login")
  }

  // Determine active org to fetch context-aware data (e.g. recents)
  let activeOrgId = (session.session as Record<string, unknown>).activeOrganizationId as string | undefined
  if (!activeOrgId) {
    const orgs = await listOrganizations(reqHeaders)
    activeOrgId = orgs[0]?.id
  }

  let recentRepos: { id: string; name: string }[] = []
  if (activeOrgId) {
    const container = getContainer()
    try {
      const repos = await container.relationalStore.getRepos(activeOrgId)
      recentRepos = repos
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5)
        .map((r) => ({ id: r.id, name: r.fullName }))
    } catch {
      // Fail gracefully if DB is unreachable
    }
  }

  return (
    <DashboardAccountProvider>
      <div className="flex min-h-screen flex-col bg-[#0A0A0F]">
        <DashboardHeader />
        <div className="flex flex-1 overflow-hidden">
          <aside className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-[#0A0A0F]">
            <div className="p-3 pt-4" />
            <DashboardNav recentRepos={recentRepos} />
            <div className="flex-1 min-h-0" />
            <div className="shrink-0 border-t border-white/10 p-2">
              <UserProfileMenu serverUser={session.user} />
            </div>
          </aside>
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </DashboardAccountProvider>
  )
}
