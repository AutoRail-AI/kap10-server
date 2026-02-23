"use client"

import { useEffect, useState } from "react"
import { Brain, Target, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

interface DeadCodeRisk {
  riskType: string
  description: string
  severity: "low" | "medium" | "high"
  category: string
  affectedCount?: number
  entities?: Array<{ id: string; name: string; filePath: string; detail?: string }>
}

interface PatternAlignment {
  id: string
  name: string
  title: string
  type: string
  adherenceRate: number
  confidence: number
  status: string
  evidenceCount: number
  language?: string
}

interface IntelligenceData {
  cruft: {
    deadCode: DeadCodeRisk[]
    totalDeadCodeEntities: number
  }
  alignment: {
    patterns: PatternAlignment[]
    averageAdherence: number
  }
  boundedContextBleed: Array<{
    sourceFeature: string
    targetFeature: string
    sourceEntity: { id: string; name: string; filePath: string }
    targetEntity: { id: string; name: string; filePath: string }
    message: string
  }>
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  high: "bg-red-500/20 text-red-400 border-red-500/30",
}

const TYPE_COLORS: Record<string, string> = {
  structural: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  naming: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "error-handling": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  import: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  testing: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  custom: "bg-muted text-muted-foreground border-border",
}

const STATUS_COLORS: Record<string, string> = {
  detected: "bg-muted text-muted-foreground border-border",
  confirmed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  promoted: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
}

export function IntelligenceView({ repoId }: { repoId: string }) {
  const [data, setData] = useState<IntelligenceData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/repos/${repoId}/intelligence`)
        if (res.ok) {
          const json = (await res.json()) as { data: IntelligenceData }
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="glass-card border-border rounded-lg border p-6 text-center space-y-3">
        <Brain className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          No intelligence data available. Run indexing and pattern detection first.
        </p>
      </div>
    )
  }

  const sortedPatterns = [...data.alignment.patterns].sort(
    (a, b) => a.adherenceRate - b.adherenceRate
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cruft panel */}
        <div className="glass-card border-border rounded-lg border">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-grotesk text-sm font-semibold text-foreground">
                Code Cruft
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.cruft.totalDeadCodeEntities} dead code entities detected
            </p>
          </div>
          <div className="p-4">
            {data.cruft.deadCode.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">
                  No dead code detected.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.cruft.deadCode.map((risk, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${SEVERITY_COLORS[risk.severity] ?? ""}`}
                      >
                        {risk.severity}
                      </Badge>
                      <span className="text-xs text-foreground">
                        {risk.description}
                      </span>
                      {risk.affectedCount != null && (
                        <span className="text-[10px] text-muted-foreground">
                          ({risk.affectedCount} entities)
                        </span>
                      )}
                    </div>
                    {risk.entities && risk.entities.length > 0 && (
                      <div className="ml-4 space-y-1">
                        {risk.entities.slice(0, 5).map((e) => (
                          <div key={e.id} className="text-xs text-muted-foreground">
                            <span className="text-foreground">{e.name}</span>{" "}
                            <span className="truncate">{e.filePath}</span>
                          </div>
                        ))}
                        {risk.entities.length > 5 && (
                          <p className="text-[10px] text-muted-foreground">
                            +{risk.entities.length - 5} more
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Alignment panel */}
        <div className="glass-card border-border rounded-lg border">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-grotesk text-sm font-semibold text-foreground">
                Pattern Alignment
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Average adherence: {(data.alignment.averageAdherence * 100).toFixed(0)}%
            </p>
          </div>
          <div className="p-4">
            {sortedPatterns.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">
                  No patterns detected yet.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedPatterns.map((pattern) => (
                  <div key={pattern.id} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-medium text-foreground truncate">
                          {pattern.title || pattern.name}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] shrink-0 ${TYPE_COLORS[pattern.type] ?? ""}`}
                        >
                          {pattern.type}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-[10px] shrink-0 ${STATUS_COLORS[pattern.status] ?? ""}`}
                        >
                          {pattern.status}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">
                        {pattern.evidenceCount} evidence
                      </span>
                    </div>
                    {/* Adherence bar */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            pattern.adherenceRate > 0.8
                              ? "bg-emerald-400"
                              : pattern.adherenceRate > 0.5
                                ? "bg-amber-400"
                                : "bg-red-400"
                          }`}
                          style={{
                            width: `${pattern.adherenceRate * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-foreground w-8 text-right">
                        {(pattern.adherenceRate * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bounded context bleed section */}
      {data.boundedContextBleed.length > 0 && (
        <div className="glass-card border-border rounded-lg border">
          <div className="p-4 border-b border-border">
            <h3 className="font-grotesk text-sm font-semibold text-foreground">
              Bounded Context Bleed
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cross-feature mutations that may indicate architecture violations
            </p>
          </div>
          <div className="divide-y divide-border">
            {data.boundedContextBleed.map((bleed, i) => (
              <div key={i} className="p-3">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px] bg-purple-500/20 text-purple-400 border-purple-500/30">
                    {bleed.sourceFeature}
                  </Badge>
                  <span className="text-muted-foreground">→</span>
                  <Badge variant="outline" className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30">
                    {bleed.targetFeature}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {bleed.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
