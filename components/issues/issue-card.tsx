"use client"

import { useState } from "react"
import {
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
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

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
}: IssueCardProps) {
  const [entitiesExpanded, setEntitiesExpanded] = useState(false)
  const [fixExpanded, setFixExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const IconComponent = ICON_MAP[icon] ?? AlertTriangle

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
            <div className="flex items-center gap-2">
              <h4 className="font-grotesk text-sm font-semibold text-foreground">
                {title}
              </h4>
              <Badge
                variant="outline"
                className={`text-[10px] ${SEVERITY_COLORS[severity] ?? ""}`}
              >
                {severity}
              </Badge>
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

      {/* Expandable entity list */}
      {entities.length > 0 && (
        <div>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setEntitiesExpanded(!entitiesExpanded)}
          >
            {entitiesExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {entitiesExpanded ? "Hide" : "Show"} entities ({entities.length})
          </button>
          {entitiesExpanded && (
            <div className="mt-2 space-y-1 max-h-[300px] overflow-y-auto">
              {entities.slice(0, 20).map((ent) => (
                <div
                  key={ent.id}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded text-xs bg-muted/10"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-foreground font-mono text-[11px]">
                      {ent.name}
                    </span>
                    {ent.filePath && (
                      <span className="text-muted-foreground ml-2 truncate text-[10px]">
                        {ent.filePath}
                      </span>
                    )}
                  </div>
                  {ent.detail && (
                    <span className="text-muted-foreground shrink-0 text-[10px]">
                      {ent.detail}
                    </span>
                  )}
                </div>
              ))}
              {entities.length > 20 && (
                <p className="text-[10px] text-muted-foreground px-2">
                  ...and {entities.length - 20} more
                </p>
              )}
            </div>
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
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1.5"
        onClick={handleCopyPrompt}
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-400" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
        {copied ? "Copied!" : "Copy Agent Prompt"}
      </Button>
    </div>
  )
}
