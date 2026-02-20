"use client"

import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { EmptyStateRepos } from "@/components/dashboard/empty-state-repos"
import { RepoCard } from "@/components/dashboard/repo-card"
import { RepoPickerModal } from "@/components/dashboard/repo-picker-modal"
import { Button } from "@/components/ui/button"
import type { RepoRecord } from "@/lib/ports/relational-store"

export function ReposList({
  repos,
  hasInstallation,
  githubAccountLogin = null,
  installHref = "/api/github/install",
}: {
  repos: RepoRecord[]
  hasInstallation: boolean
  githubAccountLogin?: string | null
  installHref?: string
}) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)

  const handleConnect = async (repos: Array<{ githubRepoId: number; branch: string }>) => {
    await fetch("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repos }),
    })
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {hasInstallation && (
        <div className="flex justify-end">
          <Button
            size="sm"
            className="bg-rail-fade hover:opacity-90"
            onClick={() => setModalOpen(true)}
            aria-label="Add repository"
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add Repository
          </Button>
        </div>
      )}
      {repos.length === 0 && !hasInstallation ? (
        <EmptyStateRepos installHref={installHref} />
      ) : repos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border glass-card p-12 text-center">
          <p className="font-grotesk text-lg font-semibold text-foreground">No repositories yet</p>
          <p className="text-foreground mt-0.5 text-sm">
            Add repositories from your GitHub installation
            {githubAccountLogin != null ? ` (@${githubAccountLogin})` : ""}.
          </p>
          <Button
            size="lg"
            className="bg-rail-fade hover:opacity-90 mt-6"
            onClick={() => setModalOpen(true)}
            aria-label="Add repository"
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add Repository
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {repos.map((repo) => (
            <RepoCard key={repo.id} repo={repo} />
          ))}
        </div>
      )}
      <RepoPickerModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onConnect={handleConnect}
      />
    </div>
  )
}
