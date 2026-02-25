"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { Loader2, CircleAlert, PartyPopper } from "lucide-react"
import { IssueCard } from "./issue-card"
import type { IssueCardProps } from "./issue-card"

interface IssuesSummary {
  total: number
  bySeverity: { high: number; medium: number; low: number }
  byCategory: Record<string, number>
  healthScore: number
}

interface IssuesData {
  status?: "pending"
  issues: IssueCardProps[]
  summary: IssuesSummary | null
  generatedAt?: string
}

const CATEGORY_TABS = [
  { key: "all", label: "All" },
  { key: "dead_code", label: "Dead Code" },
  { key: "architecture", label: "Architecture" },
  { key: "quality", label: "Quality" },
  { key: "complexity", label: "Complexity" },
  { key: "taxonomy", label: "Taxonomy" },
] as const

const SEVERITY_CHIP_COLORS: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
}

const HEALTH_SCORE_COLORS: Record<string, string> = {
  great: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  good: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  fair: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  poor: "text-red-400 border-red-500/30 bg-red-500/10",
}

function getScoreColor(score: number): string {
  if (score >= 80) return HEALTH_SCORE_COLORS.great!
  if (score >= 60) return HEALTH_SCORE_COLORS.good!
  if (score >= 40) return HEALTH_SCORE_COLORS.fair!
  return HEALTH_SCORE_COLORS.poor!
}

export function IssuesView({ repoId }: { repoId: string }) {
  const [data, setData] = useState<IssuesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const activeCategory = searchParams.get("category") ?? "all"

  useEffect(() => {
    let cancelled = false
    async function fetchIssues() {
      try {
        setLoading(true)
        const res = await fetch(`/api/repos/${repoId}/issues`)
        if (!res.ok) throw new Error("Failed to fetch issues")
        const json = (await res.json()) as { success: boolean; data: IssuesData }
        if (!cancelled) {
          setData(json.data)
          setError(null)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void fetchIssues()
    return () => {
      cancelled = true
    }
  }, [repoId])

  function setCategory(cat: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (cat === "all") {
      params.delete("category")
    } else {
      params.set("category", cat)
    }
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading issues...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
        <CircleAlert className="mx-auto h-8 w-8 text-red-400 mb-2" />
        <p className="text-sm text-red-400">{error}</p>
      </div>
    )
  }

  // Pipeline hasn't completed analysis yet
  if (data?.status === "pending" || !data?.summary) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/2 p-12 text-center">
        <Loader2 className="mx-auto h-8 w-8 text-muted-foreground animate-spin mb-4" />
        <p className="font-grotesk text-sm font-semibold text-foreground">
          Analysis in progress
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          The pipeline hasn&apos;t completed health analysis yet. Issues will appear once the report is generated.
        </p>
      </div>
    )
  }

  // No issues found
  if (data.issues.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-12 text-center">
        <PartyPopper className="mx-auto h-8 w-8 text-emerald-400 mb-4" />
        <p className="font-grotesk text-sm font-semibold text-foreground">
          No issues detected
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Your codebase looks healthy. Keep up the good work!
        </p>
      </div>
    )
  }

  const filteredIssues =
    activeCategory === "all"
      ? data.issues
      : data.issues.filter((i) => i.category === activeCategory)

  const { summary } = data

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${getScoreColor(summary.healthScore)}`}
        >
          {summary.healthScore}/100
        </div>
        <span className="text-xs text-muted-foreground">
          {summary.total} issue{summary.total !== 1 ? "s" : ""}
        </span>
        {summary.bySeverity.high > 0 && (
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${SEVERITY_CHIP_COLORS.high}`}
          >
            {summary.bySeverity.high} high
          </span>
        )}
        {summary.bySeverity.medium > 0 && (
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${SEVERITY_CHIP_COLORS.medium}`}
          >
            {summary.bySeverity.medium} medium
          </span>
        )}
        {summary.bySeverity.low > 0 && (
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${SEVERITY_CHIP_COLORS.low}`}
          >
            {summary.bySeverity.low} low
          </span>
        )}
      </div>

      {/* Category filter tabs */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {CATEGORY_TABS.map((tab) => {
          const count =
            tab.key === "all"
              ? summary.total
              : summary.byCategory[tab.key] ?? 0
          const isActive = activeCategory === tab.key

          return (
            <button
              key={tab.key}
              onClick={() => setCategory(tab.key)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Issue cards */}
      <div className="space-y-3">
        {filteredIssues.map((issue) => (
          <IssueCard key={issue.id} {...issue} />
        ))}
        {filteredIssues.length === 0 && (
          <div className="rounded-lg border border-white/10 bg-white/2 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No issues in this category.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
