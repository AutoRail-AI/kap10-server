"use client"

import {
  ChevronsUpDown,
  FolderGit2,
  Layers,
  Plus,
} from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { useAccountContext } from "@/components/providers/account-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"

interface RepoItem {
  id: string
  name: string
  fullName: string
  status: string
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "ready"
      ? "bg-emerald-500"
      : status === "indexing"
        ? "bg-amber-500"
        : status === "error"
          ? "bg-red-500"
          : "bg-muted-foreground/50"
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
}

export function GitHubScopeSwitcher() {
  const { activeOrgId } = useAccountContext()
  const router = useRouter()
  const pathname = usePathname()

  const [repos, setRepos] = useState<RepoItem[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const activeRepoId = pathname.match(/^\/repos\/([^/]+)/)?.[1] ?? null
  const activeRepo = repos.find((r) => r.id === activeRepoId) ?? null

  const fetchRepos = useCallback(async (signal: AbortSignal) => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/repos", { signal })
      if (!res.ok) {
        setRepos([])
        return
      }
      const json = (await res.json()) as { repos?: RepoItem[] }
      if (!signal.aborted) {
        setRepos(json.repos ?? [])
      }
    } catch (_error: unknown) {
      if (!signal.aborted) {
        setRepos([])
      }
    } finally {
      if (!signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!activeOrgId) {
      setRepos([])
      return
    }
    const controller = new AbortController()
    void fetchRepos(controller.signal)
    return () => controller.abort()
  }, [activeOrgId, fetchRepos])

  // --- No workspace state ---
  if (!activeOrgId) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-muted/30">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <span className="truncate text-xs text-muted-foreground">
          No Workspace
        </span>
      </div>
    )
  }

  const triggerLabel = activeRepo ? activeRepo.name : "All Repositories"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Repository switcher"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-muted/30">
            {activeRepo ? (
              <FolderGit2 className="h-3.5 w-3.5 text-foreground" />
            ) : (
              <Layers className="h-3.5 w-3.5 text-foreground" />
            )}
          </div>
          <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground">
            {triggerLabel}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-64 border-border bg-popover"
      >
        <DropdownMenuLabel className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Repositories
        </DropdownMenuLabel>

        {/* All Repositories */}
        <DropdownMenuItem
          className="cursor-pointer gap-2 px-3"
          onSelect={() => router.push("/")}
        >
          <div
            className={`flex h-5 w-5 items-center justify-center rounded border ${
              !activeRepoId
                ? "border-electric-cyan/50 bg-electric-cyan/10"
                : "border-border bg-muted/30"
            }`}
          >
            <Layers
              className={`h-3 w-3 ${
                !activeRepoId
                  ? "text-electric-cyan"
                  : "text-muted-foreground"
              }`}
            />
          </div>
          <span
            className={`flex-1 text-sm ${
              !activeRepoId ? "text-electric-cyan" : ""
            }`}
          >
            All Repositories
          </span>
          {!activeRepoId && (
            <span className="h-1.5 w-1.5 rounded-full bg-electric-cyan" />
          )}
        </DropdownMenuItem>

        {/* Loading state */}
        {isLoading && repos.length === 0 && (
          <div className="space-y-1 px-3 py-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        )}

        {/* Repos list */}
        {!isLoading && repos.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No repositories connected
          </div>
        )}

        {repos.map((repo) => {
          const isActive = activeRepoId === repo.id
          return (
            <DropdownMenuItem
              key={repo.id}
              className="cursor-pointer gap-2 px-3"
              onSelect={() => router.push(`/repos/${repo.id}`)}
            >
              <div
                className={`flex h-5 w-5 items-center justify-center rounded border ${
                  isActive
                    ? "border-electric-cyan/50 bg-electric-cyan/10"
                    : "border-border bg-muted/30"
                }`}
              >
                <FolderGit2
                  className={`h-3 w-3 ${
                    isActive
                      ? "text-electric-cyan"
                      : "text-muted-foreground"
                  }`}
                />
              </div>
              <span
                className={`min-w-0 flex-1 truncate text-sm ${
                  isActive ? "text-electric-cyan" : ""
                }`}
              >
                {repo.name}
              </span>
              <StatusDot status={repo.status} />
              {isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-electric-cyan" />
              )}
            </DropdownMenuItem>
          )
        })}

        <DropdownMenuSeparator />

        {/* Connect Repository — orgId is set by server via install link when in dashboard */}
        <DropdownMenuItem className="cursor-pointer gap-2 px-3" asChild>
          <a href={activeOrgId ? `/api/github/install?orgId=${encodeURIComponent(activeOrgId)}` : "/api/github/install"}>
            <Plus className="h-4 w-4 text-muted-foreground" />
            <span>Connect Repository</span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
