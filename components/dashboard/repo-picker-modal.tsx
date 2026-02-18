"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

interface RepoOption {
  id: number
  fullName: string
  defaultBranch: string
  language: string | null
  private: boolean
}

export function RepoPickerModal({
  open,
  onOpenChange,
  onConnect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnect: (ids: number[]) => Promise<void>
}) {
  const [repos, setRepos] = useState<RepoOption[]>([])
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch("/api/repos/available")
      .then((r) => r.json() as Promise<{ data?: { repos?: RepoOption[] } }>)
      .then((data) => {
        const list = data?.data?.repos ?? []
        setRepos(list)
        setSelected(new Set())
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

  const handleConnect = async () => {
    if (selected.size === 0) return
    setConnecting(true)
    try {
      await onConnect(Array.from(selected))
      onOpenChange(false)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel border-border max-h-[80vh] max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-grotesk text-foreground">Add repositories</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Select repositories to connect and index.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[40vh] overflow-y-auto space-y-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-6 w-6 text-primary" />
            </div>
          ) : repos.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">No repositories available to add.</p>
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
                <span className="font-sans text-sm text-foreground truncate flex-1">{r.fullName}</span>
                {r.language && (
                  <span className="text-muted-foreground text-xs">{r.language}</span>
                )}
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-rail-fade hover:opacity-90"
            disabled={selected.size === 0 || connecting}
            onClick={handleConnect}
          >
            {connecting ? (
              <>
                <Spinner className="mr-2 h-3.5 w-3.5" />
                Connecting…
              </>
            ) : (
              `Connect ${selected.size} selected`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
