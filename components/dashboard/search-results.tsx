"use client"

import { ArrowRight, FileCode2, GitBranch } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface SearchResult {
  entityKey: string
  entityName: string
  entityType: string
  filePath: string
  lineStart?: number
  signature?: string
  score: number
  callers?: string[]
  callees?: string[]
}

interface SearchResultsProps {
  results: SearchResult[]
  queryTimeMs?: number
  mode?: string
  degraded?: Record<string, string>
}

export function SearchResults({ results, queryTimeMs, mode, degraded }: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileCode2 className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="font-grotesk text-sm font-medium text-foreground">No results found</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try a broader query or different search mode
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {queryTimeMs !== undefined && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{results.length} results</span>
          <span>·</span>
          <span>{queryTimeMs}ms</span>
          {mode && (
            <>
              <span>·</span>
              <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">
                {mode}
              </Badge>
            </>
          )}
          {degraded && Object.keys(degraded).length > 0 && (
            <>
              <span>·</span>
              <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal text-amber-500 border-amber-500/30">
                degraded
              </Badge>
            </>
          )}
        </div>
      )}

      <div className="space-y-1">
        {results.map((result) => (
          <SearchResultRow key={result.entityKey} result={result} />
        ))}
      </div>
    </div>
  )
}

function SearchResultRow({ result }: { result: SearchResult }) {
  return (
    <div className="glass-card group flex flex-col gap-1.5 rounded-md border border-border p-3 transition-colors hover:border-muted-foreground/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal text-muted-foreground">
            {result.entityType}
          </Badge>
          <span className="font-mono text-sm font-medium text-foreground">
            {result.entityName}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">
            {Math.round(result.score * 100)}%
          </span>
          <div
            className="h-1 w-8 rounded-full bg-muted/30"
            title={`Relevance: ${Math.round(result.score * 100)}%`}
          >
            <div
              className="h-full rounded-full bg-electric-cyan/60"
              style={{ width: `${Math.min(result.score * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileCode2 className="h-3 w-3" />
        <span className="font-mono">{result.filePath}</span>
        {result.lineStart !== undefined && result.lineStart > 0 && (
          <span>L{result.lineStart}</span>
        )}
      </div>

      {result.signature && (
        <div className="rounded-md bg-muted/20 px-2 py-1">
          <code className="font-mono text-xs text-foreground/80">{result.signature}</code>
        </div>
      )}

      {((result.callers && result.callers.length > 0) || (result.callees && result.callees.length > 0)) && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {result.callers && result.callers.length > 0 && (
            <span className="flex items-center gap-1">
              <GitBranch className="h-2.5 w-2.5 rotate-180" />
              {result.callers.length} caller{result.callers.length !== 1 ? "s" : ""}
            </span>
          )}
          {result.callees && result.callees.length > 0 && (
            <span className="flex items-center gap-1">
              <ArrowRight className="h-2.5 w-2.5" />
              {result.callees.length} callee{result.callees.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
