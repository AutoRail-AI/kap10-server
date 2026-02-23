"use client"

import { GitBranch, Info } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

interface RepoOption {
  id: number
  fullName: string
  defaultBranch: string
  language: string | null
  private: boolean
  installationId: number
}

interface RepoWithBranch {
  githubRepoId: number
  branch: string
}

export function RepoPickerSheet({
  open,
  onOpenChange,
  onConnect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnect: (repos: RepoWithBranch[]) => Promise<void>
}) {
  const [repos, setRepos] = useState<RepoOption[]>([])
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [step, setStep] = useState<1 | 2>(1)

  // Branch selection state: repoId -> { branches, selectedBranch, loading }
  const [branchState, setBranchState] = useState<
    Map<number, { branches: string[]; selectedBranch: string; loading: boolean }>
  >(new Map())

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setStep(1)
    setSelected(new Set())
    setBranchState(new Map())
    fetch("/api/repos/available")
      .then((r) => r.json() as Promise<{ data?: { repos?: RepoOption[] } }>)
      .then((data) => {
        const list = data?.data?.repos ?? []
        setRepos(list)
      })
      .finally(() => setLoading(false))
  }, [open])

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const fetchBranches = useCallback(
    async (repo: RepoOption) => {
      const [owner, name] = repo.fullName.split("/")
      if (!owner || !name) return

      setBranchState((prev) => {
        const next = new Map(prev)
        next.set(repo.id, {
          branches: [],
          selectedBranch: repo.defaultBranch,
          loading: true,
        })
        return next
      })

      try {
        const params = new URLSearchParams({
          owner,
          repo: name,
          installationId: String(repo.installationId),
          defaultBranch: repo.defaultBranch,
        })
        const res = await fetch(`/api/repos/available/branches?${params.toString()}`)
        const data = (await res.json()) as {
          data?: { branches?: string[]; defaultBranch?: string }
        }
        const branches = data?.data?.branches ?? [repo.defaultBranch]
        setBranchState((prev) => {
          const next = new Map(prev)
          next.set(repo.id, {
            branches,
            selectedBranch: repo.defaultBranch,
            loading: false,
          })
          return next
        })
      } catch {
        setBranchState((prev) => {
          const next = new Map(prev)
          next.set(repo.id, {
            branches: [repo.defaultBranch],
            selectedBranch: repo.defaultBranch,
            loading: false,
          })
          return next
        })
      }
    },
    []
  )

  const handleNext = () => {
    if (selected.size === 0) return
    setStep(2)
    // Fetch branches for each selected repo
    const selectedRepos = repos.filter((r) => selected.has(r.id))
    for (const repo of selectedRepos) {
      if (!branchState.has(repo.id)) {
        void fetchBranches(repo)
      }
    }
  }

  const handleBranchChange = (repoId: number, branch: string) => {
    setBranchState((prev) => {
      const next = new Map(prev)
      const existing = next.get(repoId)
      if (existing) {
        next.set(repoId, { ...existing, selectedBranch: branch })
      }
      return next
    })
  }

  const handleConnect = async () => {
    if (selected.size === 0) return
    setConnecting(true)
    try {
      const reposToConnect: RepoWithBranch[] = Array.from(selected).map((id) => ({
        githubRepoId: id,
        branch: branchState.get(id)?.selectedBranch ?? repos.find((r) => r.id === id)?.defaultBranch ?? "main",
      }))
      await onConnect(reposToConnect)
      onOpenChange(false)
    } finally {
      setConnecting(false)
    }
  }

  const selectedRepos = repos.filter((r) => selected.has(r.id))
  const anyBranchLoading = selectedRepos.some((r) => branchState.get(r.id)?.loading)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px] flex flex-col glass-panel border-border">
        <SheetHeader>
          <SheetTitle className="font-grotesk text-foreground">
            {step === 1 ? "Add repositories" : "Choose branches"}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground text-sm">
            {step === 1
              ? "Select repositories to connect and index."
              : "Pick the branch to index for each repository."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-hidden">
          {step === 1 ? (
            <div className="h-full overflow-y-auto space-y-2 py-2">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner className="h-6 w-6 text-primary" />
                </div>
              ) : repos.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4 text-center">
                  No repositories available to add.
                </p>
              ) : (
                repos.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-3 rounded-md border border-border p-2 cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select ${r.fullName}`}
                      className="h-4 w-4 rounded border-border"
                    />
                    <span className="font-sans text-sm text-foreground truncate flex-1">
                      {r.fullName}
                    </span>
                    {r.language && (
                      <span className="text-muted-foreground text-xs">{r.language}</span>
                    )}
                  </label>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="flex gap-2 rounded-md border border-border bg-muted/30 p-3">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Choose the right branch for each repository.
                  </span>{" "}
                  Kap10 indexes the selected branch to build your code intelligence graph
                  — accurate function maps, dependency analysis, and AI suggestions depend
                  on indexing the branch with your team&apos;s latest working code. For
                  most teams this is <code className="font-mono">main</code> or{" "}
                  <code className="font-mono">develop</code>.
                </p>
              </div>
              <div className="overflow-y-auto space-y-3">
                {selectedRepos.map((repo) => {
                  const state = branchState.get(repo.id)
                  return (
                    <div
                      key={repo.id}
                      className="flex items-center gap-3 rounded-md border border-border p-2"
                    >
                      <span className="font-sans text-sm text-foreground truncate flex-1">
                        {repo.fullName}
                      </span>
                      {state?.loading ? (
                        <Spinner className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Select
                          value={state?.selectedBranch ?? repo.defaultBranch}
                          onValueChange={(val) => handleBranchChange(repo.id, val)}
                        >
                          <SelectTrigger className="h-8 w-[180px] text-xs">
                            <GitBranch className="mr-1.5 h-3 w-3 text-muted-foreground" />
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(state?.branches ?? [repo.defaultBranch]).map((b) => (
                              <SelectItem key={b} value={b} className="text-xs">
                                {b}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <SheetFooter>
          {step === 1 ? (
            <>
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-rail-fade hover:opacity-90"
                disabled={selected.size === 0}
                onClick={handleNext}
              >
                Next
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                size="sm"
                className="bg-rail-fade hover:opacity-90"
                disabled={connecting || anyBranchLoading}
                onClick={handleConnect}
              >
                {connecting ? (
                  <>
                    <Spinner className="mr-2 h-3.5 w-3.5" />
                    Connecting…
                  </>
                ) : (
                  `Connect & Index ${selected.size} selected`
                )}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
