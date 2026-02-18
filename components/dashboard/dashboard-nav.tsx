"use client"

import { FolderGit2, Search, Settings } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-1 flex-col gap-1 p-2">
      <Link
        href="/"
        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
          pathname === "/"
            ? "text-electric-cyan bg-muted/30"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
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
        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
          pathname.startsWith("/settings")
            ? "text-electric-cyan bg-muted/30"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Settings className="h-4 w-4" />
        Settings
      </Link>
    </nav>
  )
}
