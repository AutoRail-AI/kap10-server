import {
  FolderGit2,
  Search,
  Settings,
  User,
} from "lucide-react"
import { headers } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth, listOrganizations } from "@/lib/auth"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    redirect("/login")
  }

  let organizations: { id: string; name: string; slug: string }[] = []
  try {
    organizations = await listOrganizations(await headers())
  } catch {
    organizations = []
  }

  if (organizations.length === 0) {
    redirect("/onboarding")
  }

  const activeOrg = organizations[0]

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="glass-panel border-border flex w-56 flex-col border-r">
        <div className="flex h-14 items-center border-b border-border px-4">
          <span className="font-grotesk text-sm font-semibold text-foreground">
            kap10
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            <FolderGit2 className="h-4 w-4" />
            Repos
          </Link>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground"
                  aria-disabled
                >
                  <Search className="h-4 w-4" />
                  Search
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Search coming soon</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </nav>
        <div className="border-t border-border p-2">
          <div className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span className="truncate">
              {session.user.name ?? session.user.email}
            </span>
          </div>
          {activeOrg && (
            <div className="px-3 py-1 text-xs text-muted-foreground">
              {activeOrg.name}
            </div>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
