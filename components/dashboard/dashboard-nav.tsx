"use client"

import { FolderGit2, Key, LayoutDashboard, Search, Settings } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Badge } from "@/components/ui/badge"

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  disabled?: boolean
  badge?: string
}

const platformLinks: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Repositories", href: "/repos", icon: FolderGit2 },
  { label: "Search", href: "/search", icon: Search },
]

const configLinks: NavItem[] = [
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "API Keys", href: "/api-keys", icon: Key, disabled: true, badge: "Soon" },
]

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const classes = item.disabled
    ? "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm cursor-not-allowed text-muted-foreground/50"
    : `flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-muted/30 text-electric-cyan"
          : "text-muted-foreground hover:bg-muted/20 hover:text-foreground"
      }`

  const content = (
    <>
      <item.icon className="h-4 w-4" />
      <span className="flex-1">{item.label}</span>
      {active && !item.disabled && (
        <span className="h-1.5 w-1.5 rounded-full bg-electric-cyan" />
      )}
      {item.badge && (
        <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal text-muted-foreground">
          {item.badge}
        </Badge>
      )}
    </>
  )

  if (item.disabled) {
    return <span className={classes}>{content}</span>
  }

  return (
    <Link href={item.href} className={classes}>
      {content}
    </Link>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}

export function DashboardNav() {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  return (
    <nav className="flex flex-1 flex-col p-2">
      <SectionLabel>Platform</SectionLabel>
      {platformLinks.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(item.href)} />
      ))}

      <div className="flex-1" />

      <SectionLabel>Configuration</SectionLabel>
      {configLinks.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(item.href)} />
      ))}
    </nav>
  )
}
