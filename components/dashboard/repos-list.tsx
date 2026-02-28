"use client"

import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Loader2,
  MoreHorizontal,
  Plus,
  Radio,
  RotateCw,
  Search,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { EmptyStateRepos } from "@/components/dashboard/empty-state-repos"
import { RepoPickerSheet } from "@/components/dashboard/repo-picker-modal"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { RepoRecord } from "@/lib/ports/relational-store"

const PAGE_SIZE = 20

const statusConfig: Record<
  string,
  { label: string; classes: string; dot: string }
> = {
  pending: {
    label: "Pending",
    classes: "text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
  indexing: {
    label: "Indexing",
    classes: "text-warning border-warning/30",
    dot: "bg-warning animate-pulse",
  },
  embedding: {
    label: "Embedding",
    classes: "text-warning border-warning/30",
    dot: "bg-warning animate-pulse",
  },
  justifying: {
    label: "Analyzing",
    classes: "text-warning border-warning/30",
    dot: "bg-warning animate-pulse",
  },
  ready: {
    label: "Active",
    classes: "text-emerald-400 border-emerald-400/30",
    dot: "bg-emerald-400",
  },
  error: {
    label: "Error",
    classes: "text-destructive border-destructive/30",
    dot: "bg-destructive",
  },
  embed_failed: {
    label: "Failed",
    classes: "text-destructive border-destructive/30",
    dot: "bg-destructive",
  },
  justify_failed: {
    label: "Failed",
    classes: "text-destructive border-destructive/30",
    dot: "bg-destructive",
  },
}

function formatSyncAge(date: Date | string | null): string {
  if (!date) return "—"
  const h = (Date.now() - new Date(date).getTime()) / 3_600_000
  if (h < 1) {
    const m = Math.floor(h * 60)
    return m < 1 ? "Just now" : `${m}m ago`
  }
  if (h < 24) return `${Math.floor(h)}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function ReposList({
  repos: serverRepos,
  hasInstallation,
  githubAccounts: _githubAccounts = [],
  installHref = "/api/github/install",
}: {
  repos: RepoRecord[]
  hasInstallation: boolean
  githubAccounts?: Array<{ login: string; type: string }>
  installHref?: string
}) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [sortKey, setSortKey] = useState<"name" | "status" | "lastIndexedAt">(
    "lastIndexedAt"
  )
  const [sortAsc, setSortAsc] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [accountFilter, setAccountFilter] = useState<string>("all")
  const [page, setPage] = useState(0)
  // Optimistic local state: track removed repo IDs so they disappear immediately
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

  // Merge server data with optimistic removals. When server catches up, removedIds auto-clear.
  const repos = useMemo(() => {
    if (removedIds.size === 0) return serverRepos
    return serverRepos.filter((r) => !removedIds.has(r.id))
  }, [serverRepos, removedIds])

  // When server data changes (after router.refresh), clear stale optimistic removals
  useEffect(() => {
    if (removedIds.size === 0) return
    const serverIds = new Set(serverRepos.map((r) => r.id))
    setRemovedIds((prev) => {
      const next = new Set<string>()
      Array.from(prev).forEach((id) => {
        // Keep optimistic removal only if server still has the repo
        if (serverIds.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [serverRepos]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeRepo = useCallback((repoId: string) => {
    setRemovedIds((prev) => new Set(prev).add(repoId))
  }, [])

  const handleConnect = async (
    selected: Array<{ githubRepoId: number; branch: string }>
  ) => {
    const res = await fetch("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repos: selected }),
    })
    const body = (await res.json()) as {
      data?: { created?: Array<{ id: string }> }
    }
    const first = body?.data?.created?.[0]
    if (first?.id) {
      router.push(`/repos/${first.id}`)
    } else {
      router.refresh()
    }
  }

  const handleSort = useCallback(
    (key: typeof sortKey) => {
      if (sortKey === key) {
        setSortAsc(!sortAsc)
      } else {
        setSortKey(key)
        setSortAsc(key === "name")
      }
      setPage(0)
    },
    [sortKey, sortAsc]
  )

  // Derive unique GitHub accounts from repo fullName (owner/repo → owner)
  const derivedAccounts = useMemo(() => {
    const owners = new Set<string>()
    for (const r of repos) {
      const owner = r.fullName.split("/")[0]
      if (owner) owners.add(owner)
    }
    return Array.from(owners).sort()
  }, [repos])

  const filtered = useMemo(() => {
    let result = [...repos]

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.fullName.toLowerCase().includes(q)
      )
    }

    if (accountFilter !== "all") {
      result = result.filter((r) =>
        r.fullName.toLowerCase().startsWith(accountFilter.toLowerCase() + "/")
      )
    }

    const dir = sortAsc ? 1 : -1
    result.sort((a, b) => {
      if (sortKey === "name") return dir * a.name.localeCompare(b.name)
      if (sortKey === "status") return dir * a.status.localeCompare(b.status)
      const aTime = a.lastIndexedAt
        ? new Date(a.lastIndexedAt).getTime()
        : 0
      const bTime = b.lastIndexedAt
        ? new Date(b.lastIndexedAt).getTime()
        : 0
      return dir * (aTime - bTime)
    })

    return result
  }, [repos, searchQuery, accountFilter, sortKey, sortAsc])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  useEffect(() => {
    setPage(0)
  }, [searchQuery, accountFilter])

  if (repos.length === 0 && !hasInstallation) {
    return <EmptyStateRepos installHref={installHref} />
  }

  if (repos.length === 0) {
    return (
      <>
        <Card className="glass-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="font-grotesk text-xl font-semibold text-foreground">
              No repositories yet
            </p>
            <p className="mt-1 text-sm text-foreground opacity-85">
              Add repositories from your connected GitHub accounts.
            </p>
            <Button
              size="sm"
              className="bg-rail-fade hover:opacity-90 shadow-glow-purple mt-6"
              onClick={() => setModalOpen(true)}
              aria-label="Add repository"
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Add Repository
            </Button>
          </CardContent>
        </Card>
        <RepoPickerSheet
          open={modalOpen}
          onOpenChange={setModalOpen}
          onConnect={handleConnect}
        />
      </>
    )
  }

  const thBase =
    "h-9 px-4 text-left text-[10px] font-semibold uppercase tracking-wider text-white/40 select-none"
  const thSortable = `${thBase} cursor-pointer transition-colors hover:text-white/60`

  return (
    <div className="space-y-4">
      {/* Toolbar: Search + Filters + Add */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3">
          {/* Search */}
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories…"
              className="h-8 w-full rounded-md border border-white/10 bg-transparent pl-9 pr-3 text-sm text-foreground placeholder:text-white/30 focus:border-electric-cyan/40 focus:outline-none transition-colors"
            />
          </div>

          {/* Account filter */}
          {derivedAccounts.length > 1 && (
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="h-8 rounded-md border border-white/10 bg-transparent px-3 text-xs text-white/60 focus:border-electric-cyan/40 focus:outline-none transition-colors cursor-pointer"
              aria-label="Filter by GitHub account"
            >
              <option value="all" className="bg-[#0A0A0F] text-white">
                All accounts
              </option>
              {derivedAccounts.map((acct) => (
                <option
                  key={acct}
                  value={acct}
                  className="bg-[#0A0A0F] text-white"
                >
                  {acct}
                </option>
              ))}
            </select>
          )}
        </div>

        {hasInstallation && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-white/10 bg-transparent text-white/60 hover:bg-white/5 hover:text-white"
              onClick={() => router.push("/settings/connections")}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Add Org
            </Button>
            <Button
              size="sm"
              className="bg-rail-fade hover:opacity-90 shadow-glow-purple"
              onClick={() => setModalOpen(true)}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Add Repository
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 bg-white/2">
              <th
                className={thSortable}
                onClick={() => handleSort("name")}
              >
                Repository
                {sortKey === "name" && (
                  <span className="ml-1 text-white/60">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={thSortable}
                onClick={() => handleSort("status")}
              >
                Status
                {sortKey === "status" && (
                  <span className="ml-1 text-white/60">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th className={thBase}>Branch</th>
              <th className={thBase}>Files</th>
              <th className={thBase}>Entities</th>
              <th
                className={thSortable}
                onClick={() => handleSort("lastIndexedAt")}
              >
                Last Sync
                {sortKey === "lastIndexedAt" && (
                  <span className="ml-1 text-white/60">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th className={thBase}>MCP</th>
              <th className={`${thBase} w-24`} />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/6">
            {paginated.length > 0 ? (
              paginated.map((repo) => (
                <RepoRow key={repo.id} repo={repo} onRemove={removeRepo} />
              ))
            ) : (
              <tr>
                <td
                  colSpan={8}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No repositories match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-white/40">
          {filtered.length} {filtered.length === 1 ? "repository" : "repositories"}
          {searchQuery || accountFilter !== "all"
            ? ` (filtered from ${repos.length})`
            : ""}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-white/40 hover:text-white/80"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-white/60 font-mono tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-white/40 hover:text-white/80"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <RepoPickerSheet
        open={modalOpen}
        onOpenChange={setModalOpen}
        onConnect={handleConnect}
      />
    </div>
  )
}

function RepoRow({ repo, onRemove }: { repo: RepoRecord; onRemove: (id: string) => void }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)

  const cfg = statusConfig[repo.status] ?? statusConfig.pending!
  const entities = (repo.functionCount ?? 0) + (repo.classCount ?? 0)
  const _isReady = repo.status === "ready"
  const isError =
    repo.status === "error" ||
    repo.status === "embed_failed" ||
    repo.status === "justify_failed"

  const handleRetry = async () => {
    if (loading || rateLimited) return
    setLoading(true)
    try {
      const res = await fetch(`/api/repos/${repo.id}/retry`, {
        method: "POST",
      })
      if (res.status === 429) {
        setRateLimited(true)
        setTimeout(() => setRateLimited(false), 60_000)
      } else if (res.ok) {
        // Refresh server data after a short delay to allow status transition
        setTimeout(() => router.refresh(), 500)
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const tdBase = "px-4 py-3 text-sm"

  return (
    <tr className="group transition-colors hover:bg-white/3">
      <td className={tdBase}>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/3">
            <FolderGit2 className="h-4 w-4 text-white/50" />
          </div>
          <div className="flex flex-col min-w-0">
            <Link
              href={`/repos/${repo.id}`}
              className="truncate font-medium text-foreground hover:text-electric-cyan transition-colors"
            >
              {repo.name}
            </Link>
            <span className="truncate font-mono text-xs text-white/40">
              {repo.fullName}
            </span>
          </div>
        </div>
      </td>
      <td className={tdBase}>
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} />
          <span className={`text-xs font-medium ${cfg.classes.split(" ")[0]}`}>
            {cfg.label}
          </span>
          {isError && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleRetry}
              disabled={loading || rateLimited}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCw className="h-3 w-3" />
              )}
              {rateLimited ? "Wait" : "Retry"}
            </Button>
          )}
        </div>
      </td>
      <td className={tdBase}>
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3 w-3 text-white/40" />
          <span className="font-mono text-xs text-white/60">
            {repo.defaultBranch || "main"}
          </span>
        </div>
      </td>
      <td className={tdBase}>
        <span className="font-mono text-xs text-white/60">
          {repo.fileCount?.toLocaleString() ?? "—"}
        </span>
      </td>
      <td className={tdBase}>
        <span className="font-mono text-xs text-white/60">
          {entities > 0 ? entities.toLocaleString() : "—"}
        </span>
      </td>
      <td className={tdBase}>
        <span className="text-xs text-white/60">
          {formatSyncAge(repo.lastIndexedAt)}
        </span>
      </td>
      <td className={tdBase}>
        <McpSessionDot repoId={repo.id} />
      </td>
      <td className={`${tdBase} text-right`}>
        <div className="flex items-center justify-end gap-1">
          <Link href={`/repos/${repo.id}`}>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-3 text-xs border-white/15 text-white hover:text-white hover:border-electric-cyan/50 hover:bg-electric-cyan/10"
            >
              Open
              <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-7 w-7 p-0 text-white/30 hover:text-white/60"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onClick={() => navigator.clipboard.writeText(repo.id)}
              >
                Copy ID
              </DropdownMenuItem>
              {repo.onboardingPrUrl && (
                <DropdownMenuItem asChild>
                  <a
                    href={repo.onboardingPrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <GitPullRequest className="mr-2 h-3.5 w-3.5" />
                    Onboarding PR
                    <ExternalLink className="ml-auto h-3 w-3 opacity-50" />
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={async () => {
                  if (
                    confirm(
                      "Remove this repository? This will delete all indexed data."
                    )
                  ) {
                    const res = await fetch(`/api/repos/${repo.id}`, { method: "DELETE" })
                    if (res.ok) {
                      onRemove(repo.id)
                    }
                    router.refresh()
                  }
                }}
              >
                Remove Repository
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  )
}

function McpSessionDot({ repoId }: { repoId: string }) {
  const [sessions, setSessions] = useState<number | null>(null)

  useEffect(() => {
    let mounted = true
    fetch(`/api/repos/${repoId}/mcp-sessions`)
      .then((r) => r.json())
      .then((d) => {
        if (mounted) setSessions((d as { activeSessions: number }).activeSessions)
      })
      .catch(() => {
        if (mounted) setSessions(0)
      })
    return () => {
      mounted = false
    }
  }, [repoId])

  const active = sessions !== null && sessions > 0

  return (
    <div
      className="flex items-center gap-1.5"
      title={
        active
          ? `${sessions} active session${sessions > 1 ? "s" : ""}`
          : "No active sessions"
      }
    >
      <Radio
        className={`h-3 w-3 ${active ? "text-electric-cyan" : "text-white/20"}`}
      />
      <span
        className={`text-xs ${active ? "text-electric-cyan" : "text-white/30"}`}
      >
        {sessions ?? "—"}
      </span>
    </div>
  )
}
