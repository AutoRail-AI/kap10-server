"use client"

import {
  Activity,
  BadgeCheck,
  DollarSign,
  HeartPulse,
  Layers,
  RefreshCw,
  Tag,
  Trash2,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CATEGORY_INFO, FIX_GUIDANCE } from "@/lib/health/fix-guidance"
import type { HealthReportDoc, TokenUsageSummary } from "@/lib/ports/types"
import { InsightCard } from "./insight-card"

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  high: "bg-red-500/20 text-red-400 border-red-500/30",
}

const TAXONOMY_COLORS: Record<string, string> = {
  VERTICAL: "text-purple-400",
  HORIZONTAL: "text-blue-400",
  UTILITY: "text-muted-foreground",
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  dead_code: Trash2,
  architecture: Layers,
  quality: BadgeCheck,
  complexity: Activity,
  taxonomy: Tag,
}

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  B: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  C: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  D: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  F: "text-red-400 border-red-500/30 bg-red-500/10",
}

function computeGrade(risks: Array<{ severity: string }>): string {
  const high = risks.filter((r) => r.severity === "high").length
  const medium = risks.filter((r) => r.severity === "medium").length
  if (high >= 3) return "F"
  if (high >= 1) return "D"
  if (medium > 3) return "C"
  if (medium > 0) return "B"
  return "A"
}

function confidenceColor(confidence: number): string {
  if (confidence < 0.5) return "text-red-400"
  if (confidence < 0.8) return "text-amber-400"
  return "text-emerald-400"
}

interface InsightsResponse {
  report: HealthReportDoc
  summary: {
    healthGrade: string
    totalInsights: number
    criticalCount: number
    categories: Record<string, number>
  }
}

export function HealthReportView({ repoId }: { repoId: string }) {
  const [report, setReport] = useState<HealthReportDoc | null>(null)
  const [summary, setSummary] = useState<InsightsResponse["summary"] | null>(null)
  const [costs, setCosts] = useState<TokenUsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [insightsRes, costsRes] = await Promise.all([
          fetch(`/api/repos/${repoId}/health/insights`),
          fetch(`/api/repos/${repoId}/costs`),
        ])
        if (insightsRes.ok) {
          const json = (await insightsRes.json()) as { data: InsightsResponse & { status?: string } }
          if ("status" in json.data && json.data.status === "pending") {
            setPending(true)
          } else {
            setReport(json.data.report)
            setSummary(json.data.summary)
          }
        } else {
          // Fallback to basic health endpoint
          const healthRes = await fetch(`/api/repos/${repoId}/health`)
          if (healthRes.ok) {
            const json = (await healthRes.json()) as { data: HealthReportDoc & { status?: string } }
            if ("status" in json.data && json.data.status === "pending") {
              setPending(true)
            } else {
              setReport(json.data)
            }
          }
        }
        if (costsRes.ok) {
          const json = (await costsRes.json()) as { data: TokenUsageSummary }
          setCosts(json.data)
        }
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [repoId])

  const handleRegenerate = async () => {
    setRegenerating(true)
    try {
      await fetch(`/api/repos/${repoId}/health/regenerate`, { method: "POST" })
    } finally {
      setRegenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (pending || !report) {
    return (
      <div className="glass-card border-border rounded-lg border p-6 text-center space-y-3">
        <HeartPulse className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          No health report available yet.
        </p>
        <Button
          size="sm"
          className="bg-rail-fade hover:opacity-90"
          onClick={handleRegenerate}
          disabled={regenerating}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${regenerating ? "animate-spin" : ""}`} />
          Generate Report
        </Button>
      </div>
    )
  }

  const grade = summary?.healthGrade ?? computeGrade(report.risks)
  const gradeColor = GRADE_COLORS[grade] ?? GRADE_COLORS["F"]

  // Group risks by category
  const risksByCategory = new Map<string, typeof report.risks>()
  for (const risk of report.risks) {
    const cat = risk.category ?? "quality"
    if (!risksByCategory.has(cat)) risksByCategory.set(cat, [])
    risksByCategory.get(cat)!.push(risk)
  }

  const categoryOrder = ["dead_code", "architecture", "quality", "complexity", "taxonomy"]

  return (
    <div className="space-y-6">
      {/* Grade Hero + Stats */}
      <div className="glass-card border-border rounded-lg border p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`flex items-center justify-center w-16 h-16 rounded-lg border text-3xl font-bold font-grotesk ${gradeColor}`}>
              {grade}
            </div>
            <div>
              <h3 className="font-grotesk text-sm font-semibold text-foreground">Health Grade</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {report.risks.length} insights found
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={handleRegenerate}
            disabled={regenerating}
          >
            <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Total Entities</p>
            <p className="text-xl font-semibold text-foreground">{report.total_entities}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Justified</p>
            <p className="text-xl font-semibold text-foreground">{report.justified_entities}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg Confidence</p>
            <p className={`text-xl font-semibold ${confidenceColor(report.average_confidence)}`}>
              {(report.average_confidence * 100).toFixed(0)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Risks</p>
            <div className="flex items-center gap-2 mt-1">
              {report.risks.filter((r) => r.severity === "high").length > 0 && (
                <Badge variant="outline" className={`text-[10px] ${SEVERITY_COLORS["high"]}`}>
                  {report.risks.filter((r) => r.severity === "high").length} high
                </Badge>
              )}
              {report.risks.filter((r) => r.severity === "medium").length > 0 && (
                <Badge variant="outline" className={`text-[10px] ${SEVERITY_COLORS["medium"]}`}>
                  {report.risks.filter((r) => r.severity === "medium").length} medium
                </Badge>
              )}
              {report.risks.filter((r) => r.severity === "low").length > 0 && (
                <Badge variant="outline" className={`text-[10px] ${SEVERITY_COLORS["low"]}`}>
                  {report.risks.filter((r) => r.severity === "low").length} low
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Taxonomy breakdown */}
        <div className="flex gap-4 mt-4 pt-3 border-t border-border">
          {Object.entries(report.taxonomy_breakdown).map(([taxonomy, count]) => (
            <div key={taxonomy} className="flex items-center gap-2 text-xs">
              <span className={TAXONOMY_COLORS[taxonomy] ?? "text-muted-foreground"}>
                {taxonomy}
              </span>
              <span className="text-muted-foreground">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Category sections */}
      {report.risks.length === 0 ? (
        <div className="glass-card border-border rounded-lg border p-6 text-center space-y-2">
          <div className="text-emerald-400 text-3xl">✓</div>
          <p className="text-sm font-medium text-foreground">No issues found</p>
          <p className="text-xs text-muted-foreground">Your codebase looks healthy.</p>
        </div>
      ) : (
        categoryOrder
          .filter((cat) => risksByCategory.has(cat))
          .map((cat) => {
            const catRisks = risksByCategory.get(cat)!
            const info = CATEGORY_INFO[cat]
            const CatIcon = CATEGORY_ICONS[cat] ?? Tag

            return (
              <div key={cat} className="space-y-3">
                <div className="flex items-center gap-2">
                  <CatIcon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-grotesk text-sm font-semibold text-foreground">
                    {info?.label ?? cat} ({catRisks.length})
                  </h3>
                </div>
                <div className="space-y-3">
                  {catRisks.map((risk, i) => {
                    const guidance = FIX_GUIDANCE[risk.riskType]
                    return (
                      <InsightCard
                        key={`${risk.riskType}-${i}`}
                        riskType={risk.riskType}
                        severity={risk.severity}
                        description={risk.description}
                        affectedCount={risk.affectedCount}
                        entities={risk.entities}
                        title={guidance?.title ?? risk.riskType}
                        icon={guidance?.icon ?? "AlertTriangle"}
                        howToFix={guidance?.howToFix ?? "Review and address the identified issues."}
                        ruleTemplate={guidance?.ruleTemplate}
                        repoId={repoId}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })
      )}

      {/* Cost tracking */}
      {costs && (costs.total_input_tokens > 0 || costs.total_output_tokens > 0) && (
        <div className="glass-card border-border rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-grotesk text-sm font-semibold text-foreground">Token Usage</h3>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Input Tokens</p>
              <p className="text-base font-semibold text-foreground">
                {costs.total_input_tokens.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Output Tokens</p>
              <p className="text-base font-semibold text-foreground">
                {costs.total_output_tokens.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Estimated Cost</p>
              <p className="text-base font-semibold text-emerald-400">
                ${costs.estimated_cost_usd.toFixed(4)}
              </p>
            </div>
          </div>
          {Object.keys(costs.by_model).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">By Model</p>
              {Object.entries(costs.by_model).map(([model, usage]) => (
                <div key={model} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{model}</span>
                  <span className="text-foreground">
                    {usage.input_tokens.toLocaleString()} in / {usage.output_tokens.toLocaleString()} out
                    {usage.cost_usd > 0 && ` · $${usage.cost_usd.toFixed(4)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Generated: {new Date(report.generated_at).toLocaleString()}
      </p>
    </div>
  )
}
