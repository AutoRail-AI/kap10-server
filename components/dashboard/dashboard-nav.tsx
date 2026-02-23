"use client"

import { Folder, FolderGit2, LayoutDashboard, Search } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const platformLinks: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Repositories", href: "/repos", icon: FolderGit2 },
  { label: "Search", href: "/search", icon: Search },
]

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const baseClasses =
    "group relative flex h-8 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-all duration-200"

  const activeClasses = active
    ? "bg-white/[0.08] text-white"
    : "text-white/60 hover:bg-white/5 hover:text-white"

  const Icon = item.icon

  return (
    <Link href={item.href} className={`${baseClasses} ${activeClasses}`}>
      {active && (
        <span
          className="absolute left-0 top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-r-full bg-[#00E5FF]"
          aria-hidden
        />
      )}
      <Icon
        className={`h-4 w-4 shrink-0 transition-colors ${
          active ? "text-[#00E5FF]" : "opacity-70 group-hover:opacity-100"
        }`}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.label === "Search" && (
        <kbd className="ml-auto hidden font-mono text-[10px] font-medium opacity-0 transition-opacity group-hover:opacity-40 sm:inline-block">
          ⌘K
        </kbd>
      )}
    </Link>
  )
}

function RecentRepoLink({
  repo,
  active,
}: {
  repo: { id: string; name: string }
  active: boolean
}) {
  const baseClasses =
    "group relative flex h-8 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-all duration-200"

  const activeClasses = active
    ? "bg-white/[0.08] text-white"
    : "text-white/60 hover:bg-white/5 hover:text-white"

  return (
    <Link
      href={`/repos/${repo.id}`}
      className={`${baseClasses} ${activeClasses}`}
    >
      {active && (
        <span
          className="absolute left-0 top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-r-full bg-[#00E5FF]"
          aria-hidden
        />
      )}
      <Folder
        className={`h-4 w-4 shrink-0 transition-colors ${
          active ? "text-[#00E5FF]" : "opacity-70 group-hover:opacity-100"
        }`}
      />
      <span className="flex-1 truncate">{repo.name}</span>
    </Link>
  )
}

export function DashboardNav({
  recentRepos = [],
}: {
  recentRepos?: { id: string; name: string }[]
}) {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  const isRepoActive = (repoId: string) => {
    return pathname.startsWith(`/repos/${repoId}`)
  }

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-2">
      <div className="space-y-0.5">
        {platformLinks.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </div>

      {recentRepos.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Recents
          </p>
          <div className="space-y-0.5">
            {recentRepos.map((repo) => (
              <RecentRepoLink
                key={repo.id}
                repo={repo}
                active={isRepoActive(repo.id)}
              />
            ))}
          </div>
        </div>
      )}
    </nav>
  )
}
