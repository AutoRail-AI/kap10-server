import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { DashboardAccountProvider } from "@/components/dashboard/dashboard-account-provider"
import { DashboardNav } from "@/components/dashboard/dashboard-nav"
import { UserProfileMenu } from "@/components/dashboard/user-profile-menu"
import { auth } from "@/lib/auth"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    redirect("/login")
  }

  return (
    <DashboardAccountProvider>
      <div className="flex min-h-screen bg-background">
        <aside className="glass-panel border-border flex w-56 flex-col border-r">
          <DashboardNav />
          <div className="border-t border-border p-2">
            <UserProfileMenu serverUser={session.user} />
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </DashboardAccountProvider>
  )
}
