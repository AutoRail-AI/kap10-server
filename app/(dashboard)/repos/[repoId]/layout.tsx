"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, Code, LayoutGrid, HeartPulse, Clock, GitCommit } from "lucide-react"

const tabs = [
  { label: "Code", href: "", icon: Code },
  { label: "Blueprint", href: "/blueprint", icon: LayoutGrid },
  { label: "Health", href: "/health", icon: HeartPulse },
  { label: "Activity", href: "/activity", icon: Activity },
  { label: "Timeline", href: "/timeline", icon: Clock },
  { label: "Commits", href: "/commits", icon: GitCommit },
] as const

export default function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ repoId: string }>
}) {
  const pathname = usePathname()

  // Extract repoId from pathname since params is a promise in client components
  const repoIdMatch = pathname.match(/\/repos\/([^/]+)/)
  const repoId = repoIdMatch?.[1] ?? ""
  const basePath = `/repos/${repoId}`

  // Determine active tab based on path after /repos/[repoId]
  const subPath = pathname.replace(basePath, "")

  return (
    <div className="space-y-0">
      <nav className="flex items-center gap-0 border-b border-border mb-0">
        {tabs.map((tab) => {
          const isActive = tab.href === ""
            ? subPath === "" || subPath === "/"
            : subPath.startsWith(tab.href)
          const Icon = tab.icon

          return (
            <Link
              key={tab.label}
              href={`${basePath}${tab.href}`}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          )
        })}
      </nav>
      {children}
    </div>
  )
}
