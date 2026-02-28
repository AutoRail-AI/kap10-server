"use client"

import { LayoutGrid } from "lucide-react"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import type { FeatureAggregation } from "@/lib/ports/types"

const TAXONOMY_COLORS: Record<string, string> = {
  VERTICAL: "bg-purple-500",
  HORIZONTAL: "bg-blue-500",
  UTILITY: "bg-muted-foreground",
}

function TaxonomyBar({ breakdown }: { breakdown: Record<string, number> }) {
  const total = Object.values(breakdown).reduce((sum: number, v) => sum + v, 0)
  if (total === 0) return null

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
      {Object.entries(breakdown).map(([taxonomy, count]) => (
        <div
          key={taxonomy}
          className={`${TAXONOMY_COLORS[taxonomy] ?? "bg-muted-foreground"}`}
          style={{ width: `${(count / total) * 100}%` }}
        />
      ))}
    </div>
  )
}

function confidenceColor(confidence: number): string {
  if (confidence < 0.5) return "text-red-400"
  if (confidence < 0.7) return "text-amber-400"
  return "text-emerald-400"
}

function confidenceGlow(confidence: number): string {
  if (confidence < 0.5) return "ring-1 ring-red-500/20 shadow-[0_0_12px_rgba(239,68,68,0.08)]"
  if (confidence < 0.7) return "ring-1 ring-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.06)]"
  return ""
}

interface BlueprintData {
  features: FeatureAggregation[]
  health: {
    total_entities: number
    justified_entities: number
    average_confidence: number
    taxonomy_breakdown: Record<string, number>
  } | null
}

export function BlueprintView({ repoId }: { repoId: string }) {
  const [data, setData] = useState<BlueprintData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/repos/${repoId}/blueprint`)
        if (res.ok) {
          const json = (await res.json()) as { data: BlueprintData }
          setData(json.data)
        }
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [repoId])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    )
  }

  if (!data || data.features.length === 0) {
    return (
      <div className="glass-card border-border rounded-lg border p-6 text-center">
        <LayoutGrid className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          No blueprint data available. Run the justification workflow first.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Health summary card */}
      {data.health && (
        <div className="glass-card border-border rounded-lg border p-4">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Total Entities</p>
              <p className="text-lg font-semibold text-foreground">{data.health.total_entities}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Justified</p>
              <p className="text-lg font-semibold text-foreground">{data.health.justified_entities}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Confidence</p>
              <p className={`text-lg font-semibold ${confidenceColor(data.health.average_confidence)}`}>
                {(data.health.average_confidence * 100).toFixed(0)}%
              </p>
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1">Taxonomy</p>
              <TaxonomyBar breakdown={data.health.taxonomy_breakdown} />
              <div className="flex gap-3 mt-1">
                {Object.entries(data.health.taxonomy_breakdown).map(([t, count]) => (
                  <span key={t} className="text-[10px] text-muted-foreground">
                    {t}: {count}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feature grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.features.map((feature) => (
          <div key={feature.id} className={`glass-card border-border rounded-lg border p-4 space-y-3 ${confidenceGlow(feature.average_confidence)}`}>
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                {feature.feature_tag}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {feature.entity_count} entities
              </span>
            </div>
            <TaxonomyBar breakdown={feature.taxonomy_breakdown} />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Avg confidence</span>
              <span className={`font-medium ${confidenceColor(feature.average_confidence)}`}>
                {(feature.average_confidence * 100).toFixed(0)}%
              </span>
            </div>
            {feature.entry_points.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Entry points</p>
                <div className="flex flex-wrap gap-1">
                  {feature.entry_points.slice(0, 3).map((ep) => (
                    <span key={ep} className="text-[10px] font-mono text-muted-foreground bg-muted/30 rounded px-1 py-0.5">
                      {ep}
                    </span>
                  ))}
                  {feature.entry_points.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{feature.entry_points.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
