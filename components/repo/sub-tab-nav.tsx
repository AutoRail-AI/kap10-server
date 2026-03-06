"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

interface SubTab {
  label: string
  href: string
}

interface SubTabNavProps {
  tabs: SubTab[]
  basePath: string
}

export function SubTabNav({ tabs, basePath }: SubTabNavProps) {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-1 border-b border-white/10">
      {tabs.map((tab) => {
        const fullHref = `${basePath}${tab.href}`
        const isActive =
          tab.href === ""
            ? pathname === basePath || pathname === `${basePath}/`
            : pathname.startsWith(fullHref)

        return (
          <Link
            key={tab.label}
            href={fullHref}
            className={`px-3 py-2 text-[13px] font-medium transition-colors border-b-2 -mb-px ${
              isActive
                ? "border-[#00E5FF] text-white"
                : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
