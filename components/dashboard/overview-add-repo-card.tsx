"use client"

import { Plus } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

interface OverviewAddRepoCardProps {
  installHref: string
  orgName: string
}

/**
 * Dashed-border "Add New" card. Same dimensions as repo cards.
 */
export function OverviewAddRepoCard({
  installHref,
  orgName,
}: OverviewAddRepoCardProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-transparent p-6 transition-all duration-200 hover:border-electric-cyan/40 hover:bg-electric-cyan/5 group">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-border group-hover:border-electric-cyan/40 transition-colors">
        <Plus className="h-6 w-6 text-muted-foreground group-hover:text-electric-cyan transition-colors" />
      </div>
      <div className="space-y-1 text-center">
        <p className="text-sm text-muted-foreground">
          Select an existing GitHub repository from {orgName} to begin indexing.
        </p>
        <Button
          size="sm"
          asChild
          className="mt-2 border border-electric-cyan/30 bg-transparent text-electric-cyan hover:bg-electric-cyan/10 hover:border-electric-cyan/50"
        >
          <Link href={installHref}>Connect Repository</Link>
        </Button>
      </div>
    </div>
  )
}
