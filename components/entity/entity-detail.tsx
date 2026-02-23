"use client"

import { AlertTriangle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"

const TAXONOMY_COLORS: Record<string, string> = {
  VERTICAL: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  HORIZONTAL: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  UTILITY: "bg-muted text-muted-foreground border-border",
}

const ARCH_PATTERN_COLORS: Record<string, string> = {
  pure_domain: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  pure_infrastructure: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  adapter: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  mixed: "bg-red-500/20 text-red-400 border-red-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
}

function confidenceColor(confidence: number): string {
  if (confidence < 0.5) return "text-red-400"
  if (confidence < 0.8) return "text-amber-400"
  return "text-emerald-400"
}

function qualityScoreColor(score: number): string {
  if (score < 0.3) return "bg-red-500/20 text-red-400 border-red-500/30"
  if (score < 0.5) return "bg-amber-500/20 text-amber-400 border-amber-500/30"
  if (score < 0.7) return "bg-blue-500/20 text-blue-400 border-blue-500/30"
  return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
}

export function EntityDetail({
  entity,
  justification,
  callers,
  callees,
  qualityScore,
  qualityFlags,
  architecturalPattern,
  propagatedFeatureTag,
  propagatedDomainConcepts,
  isDeadCode,
}: {
  entity: EntityDoc
  justification: JustificationDoc | null
  callers: EntityDoc[]
  callees: EntityDoc[]
  qualityScore?: number | null
  qualityFlags?: string[]
  architecturalPattern?: string | null
  propagatedFeatureTag?: string | null
  propagatedDomainConcepts?: string[] | null
  isDeadCode?: boolean
}) {
  return (
    <div className="space-y-6">
      {/* Dead Code Warning */}
      {isDeadCode && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-400">Dead Code</p>
            <p className="text-xs text-amber-400/70">
              This entity has no inbound references and is not exported or an entry point.
            </p>
          </div>
        </div>
      )}

      {/* Entity info */}
      <div className="glass-card border-border rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-grotesk text-base font-semibold text-foreground">
              {entity.name}
            </h2>
            <p className="text-sm text-muted-foreground">{entity.kind}</p>
          </div>
          <Badge variant="outline" className="text-xs">
            {entity.file_path}
            {entity.start_line ? `:${String(entity.start_line)}` : ""}
          </Badge>
        </div>
        {typeof entity.signature === "string" && entity.signature && (
          <pre className="text-xs font-mono text-muted-foreground bg-muted/30 rounded p-2 overflow-x-auto">
            {entity.signature}
          </pre>
        )}
      </div>

      {/* Justification card */}
      {justification && (
        <div className="glass-card border-border rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-grotesk text-sm font-semibold text-foreground">
              Business Justification
            </h3>
            <Badge
              variant="outline"
              className={TAXONOMY_COLORS[justification.taxonomy] ?? ""}
            >
              {justification.taxonomy}
            </Badge>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Confidence:</span>
            <span className={`font-medium ${confidenceColor(justification.confidence)}`}>
              {(justification.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-muted-foreground">Model:</span>
            <span className="text-foreground text-xs">
              {justification.model_tier}
              {justification.model_used ? ` (${justification.model_used})` : ""}
            </span>
          </div>

          <p className="text-sm text-foreground">{justification.business_purpose}</p>

          {justification.domain_concepts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {justification.domain_concepts.map((concept) => (
                <Badge key={concept} variant="outline" className="text-xs">
                  {concept}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Feature:</span>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
              {justification.feature_tag}
            </Badge>
          </div>

          {justification.compliance_tags.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Compliance:</span>
              <div className="flex gap-1">
                {justification.compliance_tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!justification && (
        <div className="glass-card border-border rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            No justification available. Run the justification workflow to classify this entity.
          </p>
        </div>
      )}

      {/* Quality Score + Architectural Pattern */}
      {(qualityScore !== null && qualityScore !== undefined) || architecturalPattern ? (
        <div className="glass-card border-border rounded-lg border p-4 space-y-3">
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            Analysis Details
          </h3>

          <div className="flex flex-wrap gap-4">
            {qualityScore !== null && qualityScore !== undefined && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Quality:</span>
                <Badge
                  variant="outline"
                  className={`text-xs ${qualityScoreColor(qualityScore)}`}
                >
                  {(qualityScore * 100).toFixed(0)}%
                </Badge>
              </div>
            )}

            {architecturalPattern && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Architecture:</span>
                <Badge
                  variant="outline"
                  className={`text-xs ${ARCH_PATTERN_COLORS[architecturalPattern] ?? ARCH_PATTERN_COLORS["unknown"]}`}
                >
                  {architecturalPattern.replace(/_/g, " ")}
                </Badge>
              </div>
            )}
          </div>

          {qualityFlags && qualityFlags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {qualityFlags.map((flag) => (
                <span
                  key={flag}
                  className="inline-block px-2 py-0.5 rounded text-[10px] text-muted-foreground bg-muted/30"
                >
                  {flag}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Propagated Context */}
      {(propagatedFeatureTag || (propagatedDomainConcepts && propagatedDomainConcepts.length > 0)) && (
        <div className="glass-card border-border rounded-lg border p-4 space-y-3">
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            Propagated Context
          </h3>
          <p className="text-xs text-muted-foreground">
            These values differ from the direct justification — they were propagated from connected entities.
          </p>
          {propagatedFeatureTag && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Feature Tag:</span>
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
                {propagatedFeatureTag}
              </Badge>
            </div>
          )}
          {propagatedDomainConcepts && propagatedDomainConcepts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {propagatedDomainConcepts.map((concept) => (
                <Badge key={concept} variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
                  {concept}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Callers / Callees */}
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-card border-border rounded-lg border p-4 space-y-2">
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            Callers ({callers.length})
          </h3>
          {callers.length === 0 && (
            <p className="text-xs text-muted-foreground">No callers</p>
          )}
          <ul className="space-y-1">
            {callers.map((c) => (
              <li key={c.id} className="text-xs text-muted-foreground">
                <span className="text-foreground font-medium">{c.name}</span>{" "}
                <span className="text-muted-foreground">({c.kind})</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="glass-card border-border rounded-lg border p-4 space-y-2">
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            Callees ({callees.length})
          </h3>
          {callees.length === 0 && (
            <p className="text-xs text-muted-foreground">No callees</p>
          )}
          <ul className="space-y-1">
            {callees.map((c) => (
              <li key={c.id} className="text-xs text-muted-foreground">
                <span className="text-foreground font-medium">{c.name}</span>{" "}
                <span className="text-muted-foreground">({c.kind})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
