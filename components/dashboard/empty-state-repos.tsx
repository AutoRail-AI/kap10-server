"use client"

import { FolderGit2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAccountContext } from "@/components/providers/account-context"

export function EmptyStateRepos({
  installHref,
}: {
  installHref?: string
}) {
  const { activeOrgId } = useAccountContext()

  // Build the install href with orgId — prefer explicit prop, fall back to context
  const href = installHref
    ?? `/api/github/install?orgId=${encodeURIComponent(activeOrgId)}`

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border glass-card p-12 text-center">
      <FolderGit2 className="text-muted-foreground mb-4 h-12 w-12" />
      <h2 className="font-grotesk text-lg font-semibold text-foreground">
        No repositories connected
      </h2>
      <p className="text-foreground mt-0.5 max-w-sm text-sm">
        Connect your first GitHub repository to get started with code
        intelligence.
      </p>
      <Button
        size="lg"
        className="bg-rail-fade hover:opacity-90 mt-6"
        aria-label="Connect GitHub"
        asChild
      >
        {/* Plain <a> so 302 redirect is a full page load, not a fetch (avoids CORS) */}
        <a href={href}>Connect GitHub</a>
      </Button>
    </div>
  )
}
