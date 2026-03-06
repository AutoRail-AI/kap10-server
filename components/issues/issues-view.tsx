"use client"

import {
  AlertTriangle,
  CircleAlert,
  Flame,
  Loader2,
  PartyPopper,
  Tags,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { HotspotView } from "./hotspot-view"
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

type ViewMode = "hotspots" | "by_feature" | "by_category"

const VIEW_TABS: Array<{ key: ViewMode; label: string; icon: React.ElementType }> = [
  { key: "hotspots", label: "Hotspots", icon: Flame },
  { key: "by_feature", label: "By Feature", icon: Tags },
  { key: "by_category", label: "By Category", icon: AlertTriangle },
]

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

/* ── "Dodged a Bullet" Banner ───────────────────────── */

function DodgedBulletBanner({
  issues,
  repoId,
}: {
  issues: IssueCardProps[]
  repoId: string
}) {
  // Find the highest-impact issue (high severity with most affected entities)
  const highSeverity = issues.filter((i) => i.severity === "high")
  if (highSeverity.length === 0) return null

  // Pick the one with most affected count
  const topIssue = highSeverity.reduce((best, curr) =>
    curr.affectedCount > best.affectedCount ? curr : best
  )

  // Find a specific entity to highlight
  const topEntity = topIssue.entities[0]
  const entityName = topEntity
    ? `\`${topEntity.filePath.split("/").pop()}\``
    : "a critical file"

  let message: string
  if (topIssue.riskType === "high_fan_in") {
    message = `Your AI agents have been operating without knowing that ${entityName} is coupled to ${topIssue.affectedCount} other entities. One wrong refactor could cascade across your codebase.`
  } else if (topIssue.riskType === "circular_dependency") {
    message = `${topIssue.affectedCount} circular dependencies detected — your codebase has hidden coupling that makes safe refactoring nearly impossible without this map.`
  } else if (topIssue.riskType === "dead_code") {
    message = `${topIssue.affectedCount} dead code entities found — your AI agents have been reading and reasoning about code that does nothing. That stops now.`
  } else if (topIssue.riskType === "architectural_violation") {
    message = `${topIssue.affectedCount} entities mix business logic with infrastructure. Your AI agents can't safely refactor what they can't cleanly separate.`
  } else {
    message = `${topIssue.affectedCount} entities flagged as ${topIssue.title.toLowerCase()} — a risk your AI agents couldn't see until now.`
  }

  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-2">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground leading-relaxed">{message}</p>
        </div>
      </div>
    </div>
  )
}

/* ── Feature-Grouped View ───────────────────────────── */

interface FeatureGroup {
  tag: string
  issues: IssueCardProps[]
  totalEntities: number
  severityCounts: { high: number; medium: number; low: number }
}

function groupByFeature(issues: IssueCardProps[]): FeatureGroup[] {
  const map = new Map<string, IssueCardProps[]>()
  for (const issue of issues) {
    const tag = issue.featureTag || "Uncategorized"
    const arr = map.get(tag)
    if (arr) {
      arr.push(issue)
    } else {
      map.set(tag, [issue])
    }
  }

  const groups: FeatureGroup[] = []
  for (const [tag, groupIssues] of map) {
    const severityCounts = { high: 0, medium: 0, low: 0 }
    let totalEntities = 0
    for (const issue of groupIssues) {
      severityCounts[issue.severity]++
      totalEntities += issue.entities.length
    }
    groups.push({ tag, issues: groupIssues, totalEntities, severityCounts })
  }

  // Sort by total risk score descending
  const sevWeight: Record<string, number> = { high: 3, medium: 2, low: 1 }
  groups.sort((a, b) => {
    const scoreA =
      a.severityCounts.high * sevWeight.high! +
      a.severityCounts.medium * sevWeight.medium! +
      a.severityCounts.low * sevWeight.low!
    const scoreB =
      b.severityCounts.high * sevWeight.high! +
      b.severityCounts.medium * sevWeight.medium! +
      b.severityCounts.low * sevWeight.low!
    return scoreB - scoreA
  })

  return groups
}

function FeatureGroupCard({
  group,
  repoId,
}: {
  group: FeatureGroup
  repoId: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-white/10 bg-white/2 p-3 space-y-2">
      <button
        className="flex items-center justify-between w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Tags className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-grotesk text-sm font-semibold text-foreground">
            {group.tag}
          </span>
          <span className="text-[10px] text-muted-foreground">
            ({group.totalEntities} entities)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {group.severityCounts.high > 0 && (
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_CHIP_COLORS.high}`}
              >
                {group.severityCounts.high} critical
              </span>
            )}
            {group.severityCounts.medium > 0 && (
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_CHIP_COLORS.medium}`}
              >
                {group.severityCounts.medium} medium
              </span>
            )}
            {group.severityCounts.low > 0 && (
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_CHIP_COLORS.low}`}
              >
                {group.severityCounts.low} low
              </span>
            )}
          </div>
          {expanded ? (
            <AlertTriangle className="h-3 w-3 text-muted-foreground rotate-180" />
          ) : (
            <AlertTriangle className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="space-y-2 pt-1">
          {group.issues.map((issue) => (
            <IssueCard key={issue.id} {...issue} repoId={repoId} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Main IssuesView ────────────────────────────────── */

export function IssuesView({ repoId }: { repoId: string }) {
  const [data, setData] = useState<IssuesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const activeView = (searchParams.get("view") as ViewMode) ?? "hotspots"
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

  function setView(view: ViewMode) {
    const params = new URLSearchParams(searchParams.toString())
    if (view === "hotspots") {
      params.delete("view")
    } else {
      params.set("view", view)
    }
    params.delete("category")
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false })
  }

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

  const featureGroups = useMemo(
    () => (data?.issues ? groupByFeature(data.issues) : []),
    [data?.issues]
  )

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

  const { summary } = data

  const filteredIssues =
    activeCategory === "all"
      ? data.issues
      : data.issues.filter((i) => i.category === activeCategory)

  return (
    <div className="space-y-4">
      {/* "Dodged a Bullet" banner */}
      <DodgedBulletBanner issues={data.issues} repoId={repoId} />

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

      {/* View mode tabs */}
      <div className="flex items-center gap-1 border-b border-white/10 pb-px">
        {VIEW_TABS.map((tab) => {
          const isActive = activeView === tab.key
          const TabIcon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <TabIcon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Hotspots view */}
      {activeView === "hotspots" && (
        <HotspotView issues={data.issues} repoId={repoId} />
      )}

      {/* By Feature view */}
      {activeView === "by_feature" && (
        <div className="space-y-2">
          {featureGroups.length > 0 ? (
            featureGroups.map((group) => (
              <FeatureGroupCard
                key={group.tag}
                group={group}
                repoId={repoId}
              />
            ))
          ) : (
            <div className="rounded-lg border border-white/10 bg-white/2 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No feature tags available. Feature grouping requires the justification pipeline.
              </p>
            </div>
          )}
        </div>
      )}

      {/* By Category view */}
      {activeView === "by_category" && (
        <div className="space-y-3">
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
              <IssueCard key={issue.id} {...issue} repoId={repoId} />
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
      )}
    </div>
  )
}
