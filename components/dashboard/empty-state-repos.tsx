"use client"

import { FolderGit2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function EmptyStateRepos() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border glass-card p-12 text-center">
      <FolderGit2 className="text-muted-foreground mb-4 h-12 w-12" />
      <h2 className="font-grotesk text-lg font-semibold text-foreground">
        No repositories connected
      </h2>
      <p className="text-muted-foreground mt-0.5 max-w-sm text-sm">
        Connect your first GitHub repository to get started with code
        intelligence.
      </p>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="mt-6 inline-block">
              <Button
                size="sm"
                className="bg-rail-fade hover:opacity-90"
                disabled
                aria-label="Connect repository (coming soon)"
              >
                Connect Repository
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>GitHub integration coming soon</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
