"use client"

import { useEffect, useState } from "react"
import { HeartPulse, RefreshCw, DollarSign } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { HealthReportDoc, TokenUsageSummary } from "@/lib/ports/types"

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

function confidenceColor(confidence: number): string {
  if (confidence < 0.5) return "text-red-400"
  if (confidence < 0.8) return "text-amber-400"
  return "text-emerald-400"
}

export function HealthReportView({ repoId }: { repoId: string }) {
  const [report, setReport] = useState<HealthReportDoc | null>(null)
  const [costs, setCosts] = useState<TokenUsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [healthRes, costsRes] = await Promise.all([
          fetch(`/api/repos/${repoId}/health`),
          fetch(`/api/repos/${repoId}/costs`),
        ])
        if (healthRes.ok) {
          const json = (await healthRes.json()) as { data: HealthReportDoc & { status?: string } }
          if ("status" in json.data && json.data.status === "pending") {
            setPending(true)
          } else {
            setReport(json.data)
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

  return (
    <div className="space-y-4">
      {/* Stats overview */}
      <div className="glass-card border-border rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-grotesk text-sm font-semibold text-foreground">Overview</h3>
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
            <p className="text-xs text-muted-foreground">Taxonomy</p>
            <div className="flex flex-col gap-0.5 mt-1">
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
        </div>
      </div>

      {/* Risks */}
      {report.risks.length > 0 && (
        <div className="glass-card border-border rounded-lg border p-4 space-y-3">
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            Risks ({report.risks.length})
          </h3>
          <div className="space-y-2">
            {report.risks.map((risk, i) => (
              <div key={i} className="flex items-start gap-3 p-2 rounded-md bg-muted/10">
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${SEVERITY_COLORS[risk.severity] ?? ""}`}
                >
                  {risk.severity}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{risk.riskType}</p>
                  <p className="text-xs text-muted-foreground">{risk.description}</p>
                  {risk.featureTag && (
                    <span className="text-[10px] text-primary">{risk.featureTag}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
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
