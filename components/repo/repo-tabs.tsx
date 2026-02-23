"use client"

import {
  Activity,
  BookOpen,
  BookText,
  Clock,
  Code,
  Fingerprint,
  GitCommit,
  GitPullRequest,
  HeartPulse,
  History,
  LayoutGrid,
  Settings2,
  Shield,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

const tabs = [
  { label: "Code", href: "", icon: Code },
  { label: "Blueprint", href: "/blueprint", icon: LayoutGrid },
  { label: "Patterns", href: "/patterns", icon: Fingerprint },
  { label: "Rules", href: "/rules", icon: Shield },
  { label: "Reviews", href: "/reviews", icon: GitPullRequest },
  { label: "Health", href: "/health", icon: HeartPulse },
  { label: "ADRs", href: "/adrs", icon: BookOpen },
  { label: "Glossary", href: "/glossary", icon: BookText },
  { label: "Activity", href: "/activity", icon: Activity },
  { label: "Timeline", href: "/timeline", icon: Clock },
  { label: "Commits", href: "/commits", icon: GitCommit },
  { label: "History", href: "/history", icon: History },
  { label: "Pipeline", href: "/pipeline", icon: Settings2 },
] as const

export function RepoTabs({ repoId }: { repoId: string }) {
  const pathname = usePathname()
  const basePath = `/repos/${repoId}`
  const subPath = pathname.replace(basePath, "")

  return (
    <nav className="flex items-center gap-0 overflow-x-auto border-b border-white/10 scrollbar-hide">
      {tabs.map((tab) => {
        const isActive =
          tab.href === ""
            ? subPath === "" || subPath === "/"
            : subPath.startsWith(tab.href)
        const Icon = tab.icon

        return (
          <Link
            key={tab.label}
            href={`${basePath}${tab.href}`}
            className={`flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors border-b-2 -mb-px ${
              isActive
                ? "border-[#00E5FF] text-white"
                : "border-transparent text-white/40 hover:text-white/70 hover:border-white/10"
            }`}
          >
            <Icon
              className={`h-3.5 w-3.5 ${isActive ? "text-[#00E5FF]" : ""}`}
            />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
