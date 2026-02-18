"use client"

import { AlertCircle } from "lucide-react"

export function CreateWorkspaceFirstBanner() {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
    >
      <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
      <p>
        Create a workspace first, then connect GitHub. Workspaces are your
        account contexts—they are not created from your GitHub account name.
      </p>
    </div>
  )
}
