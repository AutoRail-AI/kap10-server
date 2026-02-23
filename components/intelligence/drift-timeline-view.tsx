"use client"

import { useEffect, useState } from "react"
import { TrendingDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

interface DriftEntry {
  id: string
  entity_id: string
  category: "stable" | "cosmetic" | "refactor" | "intent_drift"
  embedding_similarity: number
  detected_at: string
  entityName: string
  entityKind: string
  entityFilePath: string
}

interface DriftSummary {
  stable: number
  cosmetic: number
  refactor: number
  intent_drift: number
}

const CATEGORY_COLORS: Record<string, string> = {
  stable: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  cosmetic: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  refactor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  intent_drift: "bg-red-500/20 text-red-400 border-red-500/30",
}

const CATEGORY_LABELS: Record<string, string> = {
  stable: "Stable",
  cosmetic: "Cosmetic",
  refactor: "Refactor",
  intent_drift: "Intent Drift",
}

export function DriftTimelineView({ repoId }: { repoId: string }) {
  const [driftScores, setDriftScores] = useState<DriftEntry[]>([])
  const [summary, setSummary] = useState<DriftSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<string>("")

  useEffect(() => {
    async function load() {
      try {
        const url = categoryFilter
          ? `/api/repos/${repoId}/drift?category=${categoryFilter}`
          : `/api/repos/${repoId}/drift`
        const res = await fetch(url)
        if (res.ok) {
          const json = (await res.json()) as {
            data: { driftScores: DriftEntry[]; summary: DriftSummary }
          }
          setDriftScores(json.data.driftScores ?? [])
          setSummary(json.data.summary ?? null)
        }
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [repoId, categoryFilter])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (!summary || (summary.stable + summary.cosmetic + summary.refactor + summary.intent_drift === 0)) {
    return (
      <div className="glass-card border-border rounded-lg border p-6 text-center space-y-3">
        <TrendingDown className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          No drift events detected. Run re-justification after code changes to track architectural drift.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {(["stable", "cosmetic", "refactor", "intent_drift"] as const).map(
          (cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(categoryFilter === cat ? "" : cat)}
              className={`glass-card border-border rounded-lg border p-4 text-left transition-colors hover:bg-white/5 ${
                categoryFilter === cat ? "ring-1 ring-white/20" : ""
              }`}
            >
              <p className="text-xs text-muted-foreground">
                {CATEGORY_LABELS[cat]}
              </p>
              <p className="text-2xl font-semibold text-foreground mt-1">
                {summary[cat]}
              </p>
            </button>
          )
        )}
      </div>

      {/* Filter indicator */}
      {categoryFilter && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtered by:</span>
          <Badge
            variant="outline"
            className={`text-[10px] ${CATEGORY_COLORS[categoryFilter] ?? ""}`}
          >
            {CATEGORY_LABELS[categoryFilter]}
          </Badge>
          <button
            onClick={() => setCategoryFilter("")}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {/* Timeline list */}
      <div className="space-y-3">
        {driftScores.map((entry) => (
          <div
            key={entry.id}
            className="glass-card border-border rounded-lg border p-4"
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {entry.entityName}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {entry.entityKind}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${CATEGORY_COLORS[entry.category] ?? ""}`}
                  >
                    {CATEGORY_LABELS[entry.category]}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {entry.entityFilePath}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 ml-3">
                {new Date(entry.detected_at).toLocaleDateString()}
              </span>
            </div>

            {/* Similarity bar */}
            <div className="mt-3">
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-muted-foreground">
                  Embedding Similarity
                </span>
                <span className="text-foreground">
                  {(entry.embedding_similarity * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    entry.embedding_similarity > 0.95
                      ? "bg-emerald-400"
                      : entry.embedding_similarity > 0.8
                        ? "bg-amber-400"
                        : "bg-red-400"
                  }`}
                  style={{
                    width: `${entry.embedding_similarity * 100}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
