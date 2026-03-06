"use client"

import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeAlert,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileQuestion,
  Layers,
  RefreshCcw,
  ShieldAlert,
  Tag,
  Trash2,
  TrendingDown,
  Unplug,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const ICON_MAP: Record<string, React.ElementType> = {
  AlertTriangle,
  ShieldAlert,
  Trash2,
  AlertOctagon,
  BadgeAlert,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCcw,
  Tag,
  TrendingDown,
  FileQuestion,
  Layers,
  Unplug,
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  high: "bg-red-500/20 text-red-400 border-red-500/30",
}

interface IssueEntity {
  id: string
  name: string
  filePath: string
  detail?: string
}

export interface IssueCardProps {
  id: string
  riskType: string
  title: string
  severity: "low" | "medium" | "high"
  category: string
  icon: string
  affectedCount: number
  entities: IssueEntity[]
  reasoning: string
  impact: string
  howToFix: string
  agentPrompt: string
  featureTag?: string
  repoId?: string
}

/** Group entities by file path */
function groupByFile(entities: IssueEntity[]): Map<string, IssueEntity[]> {
  const map = new Map<string, IssueEntity[]>()
  for (const ent of entities) {
    const key = ent.filePath || "unknown"
    const arr = map.get(key)
    if (arr) {
      arr.push(ent)
    } else {
      map.set(key, [ent])
    }
  }
  return map
}

/** Extract line number from detail string (e.g. "L:42" or "line 42") */
function extractLine(detail?: string): string | null {
  if (!detail) return null
  const m = detail.match(/(?:L:|line\s*)(\d+)/i)
  return m?.[1] ?? null
}

export function IssueCard({
  title,
  severity,
  icon,
  affectedCount,
  entities,
  reasoning,
  impact,
  howToFix,
  agentPrompt,
  featureTag,
  repoId,
}: IssueCardProps) {
  const [showAllEntities, setShowAllEntities] = useState(false)
  const [fixExpanded, setFixExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const IconComponent = ICON_MAP[icon] ?? AlertTriangle
  const grouped = groupByFile(entities)
  const fileEntries = Array.from(grouped.entries())

  // Show first 3 entities by default (count across files)
  const INITIAL_VISIBLE = 3
  let visibleCount = 0
  const hasMore = entities.length > INITIAL_VISIBLE

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(agentPrompt)
      setCopied(true)
      toast.success("Agent prompt copied to clipboard")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy to clipboard")
    }
  }

  return (
    <div className="glass-card border-border rounded-lg border p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IconComponent className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-grotesk text-sm font-semibold text-foreground">
                {title}
              </h4>
              <Badge
                variant="outline"
                className={`text-[10px] ${SEVERITY_COLORS[severity] ?? ""}`}
              >
                {severity}
              </Badge>
              {featureTag && (
                <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {featureTag}
                </span>
              )}
            </div>
            {affectedCount > 0 && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {affectedCount} affected
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Why this matters */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
          Why this matters
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {reasoning}
        </p>
      </div>

      {/* Impact of ignoring */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
          Impact of ignoring
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {impact}
        </p>
      </div>

      {/* Entity list — first 3 always visible, grouped by file */}
      {entities.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
            Affected entities
          </p>
          <div className="space-y-1">
            {fileEntries.map(([filePath, fileEnts]) => {
              if (!showAllEntities && visibleCount >= INITIAL_VISIBLE) return null
              const remainingSlots = showAllEntities
                ? fileEnts.length
                : Math.max(0, INITIAL_VISIBLE - visibleCount)
              const entsToShow = showAllEntities
                ? fileEnts.slice(0, 20)
                : fileEnts.slice(0, remainingSlots)
              visibleCount += entsToShow.length

              return (
                <div
                  key={filePath}
                  className="rounded-md bg-muted/10 border-l-2 border-white/10 pl-2.5 pr-2 py-1.5"
                >
                  {/* File path header */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] text-muted-foreground">
                      {repoId ? (
                        <Link
                          href={`/repos/${repoId}/code?file=${encodeURIComponent(filePath)}`}
                          className="font-mono hover:text-foreground hover:underline transition-colors"
                        >
                          {filePath}
                        </Link>
                      ) : (
                        <span className="font-mono">{filePath}</span>
                      )}
                    </span>
                    {fileEnts.length > 1 && (
                      <span className="text-[10px] text-white/20">
                        ({fileEnts.length})
                      </span>
                    )}
                  </div>
                  {/* Entities in this file */}
                  {entsToShow.map((ent) => {
                    const line = extractLine(ent.detail)
                    return (
                      <div
                        key={ent.id}
                        className="flex items-center gap-2 pl-2 py-0.5 text-xs"
                      >
                        {repoId ? (
                          <Link
                            href={`/repos/${repoId}/blueprint/entities/${ent.id}`}
                            className="font-mono text-[11px] font-medium text-foreground hover:text-primary hover:underline transition-colors"
                          >
                            {ent.name}
                          </Link>
                        ) : (
                          <span className="font-mono text-[11px] font-medium text-foreground">
                            {ent.name}
                          </span>
                        )}
                        {line && (
                          <span className="font-mono text-[10px] text-white/30 bg-white/5 px-1 rounded">
                            L:{line}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {hasMore && (
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowAllEntities(!showAllEntities)}
            >
              {showAllEntities ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {showAllEntities
                ? "Show less"
                : `Show ${entities.length - INITIAL_VISIBLE} more`}
            </button>
          )}
        </div>
      )}

      {/* How to Fix */}
      <div>
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setFixExpanded(!fixExpanded)}
        >
          {fixExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          How to Fix
        </button>
        {fixExpanded && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed pl-4 border-l border-border">
            {howToFix}
          </p>
        )}
      </div>

      {/* Copy Agent Prompt */}
      <div>
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5 bg-rail-fade hover:opacity-90"
          onClick={handleCopyPrompt}
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-400" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? "Copied!" : "Copy Agent Prompt"}
        </Button>
        <p className="text-[10px] text-white/30 mt-1">
          Paste into Claude, Cursor, or Copilot
        </p>
      </div>
    </div>
  )
}
