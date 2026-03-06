"use client"

import { Check, ChevronDown, ChevronRight, Copy, FileCode } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { IssueCardProps } from "./issue-card"

const SEVERITY_BADGE: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
}

const SEVERITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 }

interface FileHotspot {
  filePath: string
  risks: Array<{
    title: string
    severity: string
    riskType: string
    affectedCount: number
    entityCount: number
  }>
  featureTags: string[]
  totalScore: number
  totalEntities: number
  agentPrompt: string
}

function buildFilePrompt(filePath: string, risks: FileHotspot["risks"]): string {
  const riskList = risks
    .map(
      (r) =>
        `- **${r.title}** (${r.severity}) — ${r.entityCount} entities affected`
    )
    .join("\n")

  return `## Task: Fix issues in \`${filePath}\`

The following risks were detected in this file:

${riskList}

### Instructions:
1. Open \`${filePath}\` and review each flagged issue
2. Address the highest severity issues first
3. Run tests after each change to ensure nothing breaks
4. Commit changes with a clear description of what was fixed

### Expected outcome:
All flagged issues in \`${filePath}\` resolved, with tests passing.`
}

function aggregateHotspots(issues: IssueCardProps[]): FileHotspot[] {
  const fileMap = new Map<
    string,
    {
      risks: Map<
        string,
        {
          title: string
          severity: string
          riskType: string
          affectedCount: number
          entityCount: number
        }
      >
      featureTags: Set<string>
      totalEntities: number
    }
  >()

  for (const issue of issues) {
    for (const entity of issue.entities) {
      const fp = entity.filePath || "unknown"
      let entry = fileMap.get(fp)
      if (!entry) {
        entry = { risks: new Map(), featureTags: new Set(), totalEntities: 0 }
        fileMap.set(fp, entry)
      }

      entry.totalEntities++

      if (!entry.risks.has(issue.riskType)) {
        entry.risks.set(issue.riskType, {
          title: issue.title,
          severity: issue.severity,
          riskType: issue.riskType,
          affectedCount: issue.affectedCount,
          entityCount: 0,
        })
      }
      const riskEntry = entry.risks.get(issue.riskType)!
      riskEntry.entityCount++

      if (issue.featureTag) {
        entry.featureTags.add(issue.featureTag)
      }
    }
  }

  const hotspots: FileHotspot[] = []
  for (const [filePath, entry] of fileMap) {
    const risks = Array.from(entry.risks.values()).sort(
      (a, b) => (SEVERITY_WEIGHT[b.severity] ?? 1) - (SEVERITY_WEIGHT[a.severity] ?? 1)
    )
    const totalScore = risks.reduce(
      (sum, r) => sum + (SEVERITY_WEIGHT[r.severity] ?? 1) * r.entityCount,
      0
    )
    hotspots.push({
      filePath,
      risks,
      featureTags: Array.from(entry.featureTags),
      totalScore,
      totalEntities: entry.totalEntities,
      agentPrompt: buildFilePrompt(filePath, risks),
    })
  }

  return hotspots.sort((a, b) => b.totalScore - a.totalScore)
}

function HotspotRow({
  hotspot,
  repoId,
  maxScore,
}: {
  hotspot: FileHotspot
  repoId: string
  maxScore: number
}) {
  const [copied, setCopied] = useState(false)
  const barWidth = maxScore > 0 ? (hotspot.totalScore / maxScore) * 100 : 0

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(hotspot.agentPrompt)
      setCopied(true)
      toast.success("Fix prompt copied")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy")
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/2 p-3 space-y-2 hover:border-white/20 transition-colors">
      {/* File path + feature tags */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Link
              href={`/repos/${repoId}/code?file=${encodeURIComponent(hotspot.filePath)}`}
              className="font-mono text-xs text-foreground hover:text-primary hover:underline transition-colors truncate"
            >
              {hotspot.filePath}
            </Link>
          </div>
          {hotspot.featureTags.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1 ml-5.5">
              {hotspot.featureTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "Copied" : "Fix Prompt"}
          </Button>
          <Link
            href={`/repos/${repoId}/code?file=${encodeURIComponent(hotspot.filePath)}`}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5"
          >
            View &rarr;
          </Link>
        </div>
      </div>

      {/* Risk badges */}
      <div className="flex items-center gap-1.5 flex-wrap ml-5.5">
        {hotspot.risks.map((risk) => (
          <span
            key={risk.riskType}
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE[risk.severity] ?? SEVERITY_BADGE.low}`}
          >
            {risk.title}
            {risk.entityCount > 1 && (
              <span className="ml-1 text-white/40">({risk.entityCount})</span>
            )}
          </span>
        ))}
      </div>

      {/* Blast radius bar */}
      <div className="flex items-center gap-2 ml-5.5">
        <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500/60 to-red-500/60 transition-all"
            style={{ width: `${Math.max(barWidth, 2)}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {hotspot.totalEntities} entities
        </span>
      </div>
    </div>
  )
}

export function HotspotView({
  issues,
  repoId,
}: {
  issues: IssueCardProps[]
  repoId: string
}) {
  const [showAll, setShowAll] = useState(false)
  const hotspots = aggregateHotspots(issues)
  const maxScore = hotspots.length > 0 ? hotspots[0]!.totalScore : 1
  const INITIAL_COUNT = 10
  const visible = showAll ? hotspots : hotspots.slice(0, INITIAL_COUNT)

  if (hotspots.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/2 p-8 text-center">
        <p className="text-sm text-muted-foreground">No hotspots detected.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {visible.map((hs) => (
        <HotspotRow
          key={hs.filePath}
          hotspot={hs}
          repoId={repoId}
          maxScore={maxScore}
        />
      ))}
      {hotspots.length > INITIAL_COUNT && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
        >
          {showAll ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {showAll
            ? "Show less"
            : `Show all ${hotspots.length} files`}
        </button>
      )}
    </div>
  )
}
