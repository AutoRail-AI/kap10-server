"use client"

import {
  Activity,
  BookOpen,
  Brain,
  Code,
  Fingerprint,
  GitPullRequest,
  HeartPulse,
  History,
  Home,
  Layers,
  LayoutGrid,
  Shield,
  TrendingDown,
  Zap,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

const tabs = [
  { label: "Overview", href: "", icon: Home },
  { label: "Code", href: "/code", icon: Code },
  { label: "Entities", href: "/entities", icon: Layers },
  { label: "Blueprint", href: "/blueprint", icon: LayoutGrid },
  { label: "Patterns", href: "/patterns", icon: Fingerprint },
  { label: "Rules", href: "/rules", icon: Shield },
  { label: "Reviews", href: "/reviews", icon: GitPullRequest },
  { label: "Health", href: "/health", icon: HeartPulse },
  { label: "Impact", href: "/impact", icon: Zap },
  { label: "Drift", href: "/drift", icon: TrendingDown },
  { label: "Intelligence", href: "/intelligence", icon: Brain },
  { label: "ADRs", href: "/adrs", icon: BookOpen },
  { label: "Ledger", href: "/ledger", icon: History },
  { label: "Activity", href: "/activity", icon: Activity },
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
