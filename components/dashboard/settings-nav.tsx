"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const tabs = [
  { label: "General", href: "/settings" },
  { label: "Members", href: "/settings/members" },
  { label: "Connections", href: "/settings/connections" },
  { label: "API Keys", href: "/settings/api-keys" },
]

export function SettingsNav() {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === "/settings") return pathname === "/settings"
    return pathname.startsWith(href)
  }

  return (
    <div className="border-b border-border">
      <nav className="-mb-px flex gap-4">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative pb-2.5 text-sm transition-colors ${
              isActive(tab.href)
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {isActive(tab.href) && (
              <span className="absolute -bottom-px left-0 right-0 h-px bg-electric-cyan" />
            )}
          </Link>
        ))}
      </nav>
    </div>
  )
}
