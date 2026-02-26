import { redirect } from "next/navigation"
import { Suspense } from "react"
import { DashboardAccountProvider } from "@/components/dashboard/dashboard-account-provider"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { DashboardNav } from "@/components/dashboard/dashboard-nav"
import { UserProfileMenu } from "@/components/dashboard/user-profile-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { getOrgsCached, getSessionCached } from "@/lib/api/get-active-org"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSessionCached()
  if (!session) {
    redirect("/login")
  }

  // Determine active org — uses cached org list (shared with child pages)
  let activeOrgId = (session.session as Record<string, unknown>).activeOrganizationId as string | undefined
  if (!activeOrgId) {
    const orgs = await getOrgsCached()
    activeOrgId = orgs[0]?.id
  }

  return (
    <DashboardAccountProvider>
      <div className="flex min-h-screen flex-col bg-[#0A0A0F]">
        <DashboardHeader />
        <div className="flex flex-1 overflow-hidden">
          <aside className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-[#0A0A0F]">
            <div className="p-3 pt-4" />
            <Suspense fallback={<NavSkeleton />}>
              <RecentReposNav activeOrgId={activeOrgId} />
            </Suspense>
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

/** Async server component — loads recents without blocking page content. */
async function RecentReposNav({ activeOrgId }: { activeOrgId: string | undefined }) {
  let recentRepos: { id: string; name: string }[] = []
  if (activeOrgId) {
    try {
      const { getReposCached } = require("@/lib/api/cached-queries") as typeof import("@/lib/api/cached-queries")
      const repos = await getReposCached(activeOrgId)
      recentRepos = repos
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5)
        .map((r) => ({ id: r.id, name: r.fullName }))
    } catch {
      // Fail gracefully if DB is unreachable
    }
  }
  return <DashboardNav recentRepos={recentRepos} />
}

function NavSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-3">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-3/4 mt-4" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
    </div>
  )
}
