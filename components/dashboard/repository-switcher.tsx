"use client"

import {
  Check,
  ChevronsUpDown,
  FolderGit2,
  Layers,
  PlusCircle,
} from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { useAccountContext } from "@/components/providers/account-context"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface RepoItem {
  id: string
  name: string
  fullName: string
  status: string
}

function parseOwnerAndName(fullName: string): { owner: string; name: string } {
  const idx = fullName.indexOf("/")
  if (idx === -1) return { owner: "", name: fullName }
  return { owner: fullName.slice(0, idx), name: fullName.slice(idx + 1) }
}

export function RepositorySwitcher() {
  const { activeOrgId } = useAccountContext()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
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
  }, [activeOrgId])

  useEffect(() => {
    const controller = new AbortController()
    void fetchRepos(controller.signal)
    return () => controller.abort()
  }, [activeOrgId, fetchRepos])

  const triggerContent = activeRepo ? (
    (() => {
      const { owner, name } = parseOwnerAndName(activeRepo.fullName ?? activeRepo.name)
      return (
        <>
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
            <FolderGit2 className="h-3.5 w-3.5 text-foreground" />
          </div>
          <div className="min-w-0 flex-1 truncate text-left">
            <span className="block font-mono text-xs font-medium text-foreground">
              {owner && name ? `${owner} / ${name}` : activeRepo.name}
            </span>
          </div>
        </>
      )
    })()
  ) : (
    <>
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
        <Layers className="h-3.5 w-3.5 text-foreground" />
      </div>
      <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground">
        All Repositories
      </span>
    </>
  )

  const installHref = `/api/github/install?orgId=${encodeURIComponent(activeOrgId)}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="Switch repository"
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-2 text-sm transition-colors",
            "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          {triggerContent}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[260px] p-0"
        align="start"
        sideOffset={8}
      >
        <Command
          label="Repository switcher"
          className="border-0 bg-transparent"
          shouldFilter={true}
        >
          <CommandInput placeholder="Search repositories..." />
          <CommandList>
            <CommandEmpty>No repository found.</CommandEmpty>
            <CommandGroup heading="Repositories">
              <CommandItem
                value="all-repositories"
                keywords={["all", "repositories"]}
                onSelect={() => {
                  router.push("/")
                  setOpen(false)
                }}
                className="cursor-pointer gap-2"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-muted/30">
                  <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="flex flex-col">
                  <span className={cn("text-sm font-medium", !activeRepoId && "text-electric-cyan")}>
                    All Repositories
                  </span>
                  <span className="text-xs text-muted-foreground">
                    View all connected repos
                  </span>
                </div>
                {!activeRepoId && <Check className="ml-auto h-4 w-4 text-electric-cyan" />}
              </CommandItem>
              {isLoading && repos.length === 0 && (
                <div className="space-y-1 px-2 py-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              )}
              {!isLoading &&
                repos.map((repo) => {
                  const { owner, name } = parseOwnerAndName(repo.fullName ?? repo.name)
                  const isActive = activeRepoId === repo.id
                  return (
                    <CommandItem
                      key={repo.id}
                      value={`${repo.fullName ?? repo.name} ${owner} ${name}`}
                      keywords={[repo.name, owner, repo.fullName ?? ""]}
                      onSelect={() => {
                        router.push(`/repos/${repo.id}`)
                        setOpen(false)
                      }}
                      className="cursor-pointer gap-2"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-muted/30">
                        <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className={cn("text-sm font-medium text-foreground", isActive && "text-electric-cyan")}>
                          {name || repo.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {owner || "—"}
                        </span>
                      </div>
                      {isActive && <Check className="ml-auto h-4 w-4 shrink-0 text-electric-cyan" />}
                    </CommandItem>
                  )
                })}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="install-github-app"
                keywords={["install", "github", "app", "missing", "add"]}
                onSelect={() => {
                  setOpen(false)
                  window.location.href = installHref
                }}
                className="cursor-pointer gap-2 text-muted-foreground aria-selected:text-foreground"
              >
                <PlusCircle className="h-4 w-4 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-sm">Add missing repository</span>
                  <span className="text-xs text-muted-foreground">
                    Install GitHub App
                  </span>
                </div>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
