"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

interface TopEntity {
  id: string
  name: string
  kind: string
  filePath: string
  callerCount: number
}

interface BoundaryNode {
  name: string
  kind: string
  filePath: string
  depth: number
  path: string
}

interface BlastRadiusEntry {
  entity: string
  filePath: string
  upstreamBoundaries: BoundaryNode[]
  callerCount: number
}

const KIND_COLORS: Record<string, string> = {
  api_route: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  component: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  webhook_handler: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  cron_job: "bg-red-500/20 text-red-400 border-red-500/30",
}

export function ImpactView({ repoId }: { repoId: string }) {
  const [topEntities, setTopEntities] = useState<TopEntity[]>([])
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null)
  const [blastRadius, setBlastRadius] = useState<BlastRadiusEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [radiusLoading, setRadiusLoading] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/repos/${repoId}/impact`)
        if (res.ok) {
          const json = (await res.json()) as { data: { topEntities: TopEntity[] } }
          setTopEntities(json.data.topEntities ?? [])
        }
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [repoId])

  const handleSelect = async (entityId: string) => {
    setSelectedEntity(entityId)
    setRadiusLoading(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/impact?entityId=${entityId}`)
      if (res.ok) {
        const json = (await res.json()) as { data: { blastRadius: BlastRadiusEntry[] } }
        setBlastRadius(json.data.blastRadius ?? [])
      }
    } finally {
      setRadiusLoading(false)
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

  if (topEntities.length === 0) {
    return (
      <div className="glass-card border-border rounded-lg border p-6 text-center space-y-3">
        <Zap className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          No entities indexed yet. Run indexing to view impact analysis.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Top entities by caller count */}
      <div className="glass-card border-border rounded-lg border">
        <div className="p-4 border-b border-border">
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            Top Entities by Caller Count
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click to view blast radius
          </p>
        </div>
        <div className="divide-y divide-border">
          {topEntities.map((entity) => (
            <button
              key={entity.id}
              onClick={() => handleSelect(entity.id)}
              className={`w-full text-left p-3 hover:bg-white/5 transition-colors ${
                selectedEntity === entity.id ? "bg-white/5" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {entity.name}
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {entity.kind}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {entity.filePath}
                  </p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <span className="text-sm font-semibold text-foreground">
                    {entity.callerCount}
                  </span>
                  <p className="text-[10px] text-muted-foreground">callers</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Blast radius tree */}
      <div className="glass-card border-border rounded-lg border">
        <div className="p-4 border-b border-border">
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            Blast Radius
          </h3>
        </div>
        <div className="p-4">
          {radiusLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !selectedEntity ? (
            <div className="text-center py-8">
              <ArrowRight className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Select an entity to view its blast radius
              </p>
            </div>
          ) : blastRadius.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                No upstream boundaries found for this entity.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {blastRadius.map((entry, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      {entry.entity}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({entry.callerCount} callers)
                    </span>
                  </div>
                  {entry.upstreamBoundaries.length > 0 && (
                    <div className="ml-6 space-y-1.5">
                      {entry.upstreamBoundaries.map((boundary, j) => {
                        const color =
                          KIND_COLORS[boundary.kind] ??
                          "bg-muted text-muted-foreground border-border"
                        return (
                          <div
                            key={j}
                            className="flex items-center gap-2 text-xs"
                          >
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${color}`}
                            >
                              {boundary.kind}
                            </Badge>
                            <span className="text-foreground">
                              {boundary.name}
                            </span>
                            <span className="text-muted-foreground">
                              depth {boundary.depth}
                            </span>
                            <span className="text-muted-foreground truncate">
                              {boundary.filePath}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
