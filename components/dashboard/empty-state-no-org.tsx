"use client"

import { GitBranch, Laptop } from "lucide-react"
import { useTransition } from "react"
import { createDefaultWorkspace } from "@/app/actions/create-workspace"
import { Spinner } from "@/components/ui/spinner"

export function EmptyStateNoOrg() {
  const [isPending, startTransition] = useTransition()

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div className="text-center space-y-2">
        <h2 className="font-grotesk text-lg font-semibold text-foreground">
          Welcome to kap10
        </h2>
        <p className="text-sm text-foreground">
          Connect a repository to start building code intelligence, or create an
          empty workspace if your code isn&apos;t on GitHub yet.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Path 1: Connect GitHub — use <a> for full page navigation so 302 redirect is not followed by fetch (avoids CORS) */}
        <a
          href="/api/github/install"
          className="glass-card border-border group flex flex-col items-center gap-3 rounded-lg border p-6 text-center transition hover:shadow-glow-purple"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rail-fade">
            <GitBranch className="h-5 w-5 text-white" />
          </div>
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            Connect GitHub
          </h3>
          <p className="text-xs text-muted-foreground">
            Create a workspace first, then install the kap10 GitHub App to
            connect repos to that workspace.
          </p>
          <span className="text-xs font-medium text-electric-cyan group-hover:underline">
            Get started &rarr;
          </span>
        </a>

        {/* Path 2: Start without GitHub */}
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => createDefaultWorkspace())}
          className="glass-card border-border group flex flex-col items-center gap-3 rounded-lg border p-6 text-center transition hover:shadow-glow-purple disabled:opacity-60"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/30">
            <Laptop className="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            Start without GitHub
          </h3>
          <p className="text-xs text-muted-foreground">
            Create an empty workspace for local development. You can connect
            GitHub later.
          </p>
          {isPending ? (
            <Spinner className="h-3.5 w-3.5 text-electric-cyan" />
          ) : (
            <span className="text-xs font-medium text-electric-cyan group-hover:underline">
              Create workspace &rarr;
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
