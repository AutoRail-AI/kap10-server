import { headers } from "next/headers"
import Image from "next/image"
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
          <div className="flex items-center gap-2.5 px-4 py-4">
            <Image src="/autorail.svg" alt="autorail" width={32} height={32} className="h-7 w-7" />
            <span className="font-grotesk text-sm font-semibold tracking-tight text-foreground">kap10</span>
          </div>
          <div className="mx-3 border-t border-border" />
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
