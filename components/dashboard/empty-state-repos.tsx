"use client"

import { FolderGit2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
    <Card className="glass-card border-border">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/20 border border-border">
          <FolderGit2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="font-grotesk text-2xl font-semibold text-foreground mb-2">
          No repositories connected
        </h2>
        <p className="max-w-md text-sm text-foreground opacity-85 mb-8">
          Connect your first GitHub repository to get started with unerr code intelligence.
        </p>
        <Button
          size="lg"
          className="bg-rail-fade hover:opacity-90 shadow-glow-purple"
          aria-label="Connect GitHub"
          asChild
        >
          {/* Plain <a> so 302 redirect is a full page load, not a fetch (avoids CORS) */}
          <a href={href}>
            <Plus className="mr-2 h-4 w-4" />
            Connect GitHub
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}
