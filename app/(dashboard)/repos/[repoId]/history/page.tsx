"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { GitMerge } from "lucide-react"
import { MergeHistoryCard } from "@/components/repo/merge-history-card"
import { Skeleton } from "@/components/ui/skeleton"

interface MergeItem {
  id: string
  commitSha: string
  branch: string
  entryCount: number
  narrative: string
  createdAt: string
}

export default function HistoryPage() {
  const params = useParams()
  const repoId = params.repoId as string
  const [history, setHistory] = useState<MergeItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/repos/${repoId}/history`)
      .then((r) => r.json())
      .then((data) => {
        setHistory((data as { items: MergeItem[] }).items ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [repoId])

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Merge History</h1>
        <p className="text-sm text-muted-foreground">Branch merge events with AI activity narratives</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-[80px] w-full" />
          <Skeleton className="h-[80px] w-full" />
        </div>
      ) : history.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <GitMerge className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No merge history yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            AI activity narratives will appear after PRs are merged.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((item) => (
            <MergeHistoryCard key={item.id} merge={item} />
          ))}
        </div>
      )}
    </div>
  )
}
