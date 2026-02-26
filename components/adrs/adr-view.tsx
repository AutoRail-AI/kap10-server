"use client"

import { ChevronDown, ChevronRight, FileText } from "lucide-react"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import type { ADRDoc } from "@/lib/ports/types"

function AdrCard({ adr }: { adr: ADRDoc }) {
  const [consequencesExpanded, setConsequencesExpanded] = useState(false)

  return (
    <div className="glass-card border-border rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-grotesk text-sm font-semibold text-foreground">{adr.title}</h3>
          <Badge variant="outline" className="text-[10px] mt-1 bg-primary/10 text-primary border-primary/20">
            {adr.feature_area}
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {new Date(adr.generated_at).toLocaleDateString()}
        </span>
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk mb-1">
            Context
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">{adr.context}</p>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk mb-1">
            Decision
          </p>
          <p className="text-xs text-foreground leading-relaxed">{adr.decision}</p>
        </div>

        <div>
          <button
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-white/40 font-grotesk hover:text-white/60 transition-colors"
            onClick={() => setConsequencesExpanded(!consequencesExpanded)}
          >
            {consequencesExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Consequences
          </button>
          {consequencesExpanded && (
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              {adr.consequences}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export function AdrView({ repoId }: { repoId: string }) {
  const [adrs, setAdrs] = useState<ADRDoc[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/repos/${repoId}/adrs`)
        if (res.ok) {
          const json = (await res.json()) as { data: { adrs: ADRDoc[] } }
          setAdrs(json.data.adrs)
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
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (adrs.length === 0) {
    return (
      <div className="glass-card border-border rounded-lg border p-6 text-center space-y-3">
        <FileText className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          No architecture decision records yet.
        </p>
        <p className="text-xs text-muted-foreground">
          Run the justification pipeline to auto-generate architecture decision records.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{adrs.length} ADRs generated</p>
      <div className="space-y-4">
        {adrs.map((adr) => (
          <AdrCard key={adr.id} adr={adr} />
        ))}
      </div>
    </div>
  )
}
