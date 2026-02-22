"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Fingerprint, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

interface Pattern {
  id: string
  title: string
  type: string
  adherenceRate: number
  confidence: number
  status: string
  source: string
  language?: string
  evidence: Array<{ file: string; line: number }>
}

export default function PatternsPage() {
  const pathname = usePathname()
  const repoId = pathname.match(/\/repos\/([^/]+)/)?.[1] ?? ""
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchPatterns() {
      try {
        const res = await fetch(`/api/repos/${repoId}/patterns`)
        if (res.ok) {
          const json = (await res.json()) as { data: { patterns: Pattern[] } }
          setPatterns(json.data.patterns)
        }
      } catch {
        // fetch failed
      } finally {
        setLoading(false)
      }
    }
    if (repoId) fetchPatterns()
  }, [repoId])

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">Pattern Library</h1>
          <p className="text-sm text-foreground mt-0.5">
            Auto-detected code patterns and conventions in this repository
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-[120px] w-full" />
          <Skeleton className="h-[120px] w-full" />
          <Skeleton className="h-[120px] w-full" />
        </div>
      ) : patterns.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Fingerprint className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-grotesk text-sm font-medium text-foreground">No Patterns Detected</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Patterns are automatically detected during indexing. Re-index this repository to discover patterns.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {patterns.map((pattern) => (
            <div key={pattern.id} className="glass-card p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-grotesk text-sm font-medium text-foreground">
                      {pattern.title}
                    </h3>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {pattern.type}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {pattern.source}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Adherence: {Math.round(pattern.adherenceRate * 100)}%</span>
                    <span>Confidence: {Math.round(pattern.confidence * 100)}%</span>
                    {pattern.language && <span>Language: {pattern.language}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                    pattern.status === "confirmed" ? "bg-green-500/10 text-green-400" :
                    pattern.status === "promoted" ? "bg-primary/10 text-primary" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {pattern.status}
                  </span>
                  {pattern.status === "confirmed" && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs">
                      <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
                      Promote
                    </Button>
                  )}
                </div>
              </div>
              {pattern.evidence.length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Evidence ({pattern.evidence.length} locations):</p>
                  <div className="flex flex-wrap gap-1">
                    {pattern.evidence.slice(0, 5).map((e, i) => (
                      <span key={i} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                        {e.file}:{e.line}
                      </span>
                    ))}
                    {pattern.evidence.length > 5 && (
                      <span className="text-xs text-muted-foreground">+{pattern.evidence.length - 5} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
