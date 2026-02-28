"use client"

import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  FileCode,
  FolderOpen,
  Gem,
  Layers,
  Pencil,
  Search,
  Shield,
  Tag,
  X,
} from "lucide-react"
import Link from "next/link"
import { useCallback, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

/* ─── Types ─────────────────────────────────────────────── */

interface TreeNode {
  name: string
  path: string
  type: "file" | "dir"
  children?: TreeNode[]
}

interface EntityJustification {
  taxonomy: "VERTICAL" | "HORIZONTAL" | "UTILITY"
  confidence: number
  businessPurpose: string
  featureTag: string
  domainConcepts: string[]
  semanticTriples?: Array<{ subject: string; predicate: string; object: string }>
  complianceTags?: string[]
  architecturalPattern?: string | null
  reasoning?: string | null
  modelTier?: string
  modelUsed?: string | null
}

interface AnnotatedEntity {
  id: string
  name: string
  kind: string
  line: number
  signature?: string
  exported?: boolean
  fan_in?: number | null
  fan_out?: number | null
  risk_level?: "high" | "medium" | "normal" | null
  justification?: EntityJustification | null
}

/* ─── Style Maps ────────────────────────────────────────── */

const TAXONOMY_BORDER: Record<string, string> = {
  VERTICAL: "border-l-[#00E5FF]",
  HORIZONTAL: "border-l-[#8134CE]",
  UTILITY: "border-l-amber-400",
}

const TAXONOMY_BADGE: Record<string, string> = {
  VERTICAL: "bg-[#00E5FF]/10 text-[#00E5FF] border-[#00E5FF]/20",
  HORIZONTAL: "bg-[#8134CE]/10 text-[#8134CE] border-[#8134CE]/20",
  UTILITY: "bg-amber-400/10 text-amber-400 border-amber-400/20",
}

const TAXONOMY_GLOW: Record<string, string> = {
  VERTICAL: "shadow-[0_0_20px_rgba(0,229,255,0.04)]",
  HORIZONTAL: "shadow-[0_0_20px_rgba(129,52,206,0.04)]",
  UTILITY: "shadow-[0_0_20px_rgba(251,191,36,0.04)]",
}

const KIND_COLORS: Record<string, string> = {
  function: "text-[#00E5FF] border-[#00E5FF]/30 bg-[#00E5FF]/5",
  method: "text-[#00E5FF] border-[#00E5FF]/30 bg-[#00E5FF]/5",
  class: "text-[#8134CE] border-[#8134CE]/30 bg-[#8134CE]/5",
  struct: "text-[#8134CE] border-[#8134CE]/30 bg-[#8134CE]/5",
  interface: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  variable: "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
  type: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  enum: "text-[#8134CE] border-[#8134CE]/30 bg-[#8134CE]/5",
}

const KIND_SHORT: Record<string, string> = {
  function: "fn",
  method: "fn",
  class: "cls",
  struct: "cls",
  interface: "iface",
  variable: "var",
  type: "type",
  enum: "enum",
}

/** Human-readable taxonomy labels for non-developers */
const TAXONOMY_LABEL: Record<string, string> = {
  VERTICAL: "Core Business",
  HORIZONTAL: "Shared Logic",
  UTILITY: "Helper",
}

/** Brief explanation shown on hover / below the badge */
const TAXONOMY_HINT: Record<string, string> = {
  VERTICAL: "Directly implements a business feature",
  HORIZONTAL: "Reused across multiple features",
  UTILITY: "General-purpose helper or utility",
}

function confidenceLabel(c: number): { text: string; className: string } {
  const pct = Math.round(c * 100)
  if (pct >= 80) return { text: `High (${pct}%)`, className: "text-emerald-400" }
  if (pct >= 50) return { text: `Medium (${pct}%)`, className: "text-amber-400" }
  return { text: `Low (${pct}%)`, className: "text-red-400" }
}

/* ─── Sub-components ────────────────────────────────────── */

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  const gradient =
    pct >= 80
      ? "from-emerald-500/80 to-emerald-400/60"
      : pct >= 50
        ? "from-amber-500/80 to-amber-400/60"
        : "from-red-500/80 to-red-400/60"
  const label =
    pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400"

  return (
    <div className="flex items-center gap-2.5 px-4 pb-2">
      <div className="flex-1 h-[2px] rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-700 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[10px] font-mono tabular-nums ${label}`}>{pct}%</span>
    </div>
  )
}

function SemanticTriple({
  triple,
}: {
  triple: { subject: string; predicate: string; object: string }
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-mono">
      <span className="text-white/60 truncate max-w-[140px]">{triple.subject}</span>
      <span className="text-white/20 shrink-0">--</span>
      <span className="text-[#00E5FF]/60 shrink-0 italic">{triple.predicate}</span>
      <span className="text-white/20 shrink-0">--&gt;</span>
      <span className="text-white/60 truncate max-w-[140px]">{triple.object}</span>
    </div>
  )
}

/* ─── Entity Annotation Card ────────────────────────────── */

function EntityAnnotationCard({
  entity,
  repoId,
  isExpanded,
  onToggle,
  onOverride,
}: {
  entity: AnnotatedEntity
  repoId: string
  isExpanded: boolean
  onToggle: () => void
  onOverride?: (entityId: string, updated: EntityJustification) => void
}) {
  const [editing, setEditing] = useState(false)
  const [overrideTaxonomy, setOverrideTaxonomy] = useState<string>(entity.justification?.taxonomy ?? "UTILITY")
  const [overrideFeatureTag, setOverrideFeatureTag] = useState(entity.justification?.featureTag ?? "")
  const [overridePurpose, setOverridePurpose] = useState(entity.justification?.businessPurpose ?? "")
  const [saving, setSaving] = useState(false)

  const handleSaveOverride = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/entities/${entity.id}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxonomy: overrideTaxonomy,
          featureTag: overrideFeatureTag || undefined,
          businessPurpose: overridePurpose || undefined,
        }),
      })
      if (res.ok) {
        const json = (await res.json()) as { data?: { justification?: EntityJustification } }
        if (json.data?.justification && onOverride) {
          onOverride(entity.id, {
            ...entity.justification!,
            ...json.data.justification,
          })
        }
        setEditing(false)
      }
    } finally {
      setSaving(false)
    }
  }, [repoId, entity.id, overrideTaxonomy, overrideFeatureTag, overridePurpose, entity.justification, onOverride])

  const j = entity.justification
  const taxonomy = j?.taxonomy
  const isHighRisk = entity.risk_level === "high"
  const borderClass = isHighRisk
    ? "border-l-red-500"
    : taxonomy
      ? TAXONOMY_BORDER[taxonomy]
      : "border-l-white/10"
  const glowClass = isHighRisk
    ? "shadow-[0_0_20px_rgba(239,68,68,0.06)]"
    : taxonomy
      ? TAXONOMY_GLOW[taxonomy]
      : ""
  const conf = j ? confidenceLabel(j.confidence) : null
  const hasDetails =
    j &&
    ((j.reasoning && j.reasoning.length > 0) ||
      (j.semanticTriples && j.semanticTriples.length > 0) ||
      (j.complianceTags && j.complianceTags.length > 0) ||
      j.architecturalPattern)

  return (
    <div
      className={`group rounded-lg border border-white/[0.06] bg-white/[0.015] ${borderClass} border-l-[3px] overflow-hidden transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.025] ${glowClass}`}
    >
      {/* ── Header: identity row ── */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <Badge
          variant="outline"
          className={`h-[18px] shrink-0 px-1.5 text-[9px] font-mono font-bold tracking-wide uppercase ${
            KIND_COLORS[entity.kind] ?? "text-white/50 border-white/20 bg-white/5"
          }`}
        >
          {KIND_SHORT[entity.kind] ?? entity.kind}
        </Badge>
        <span className="font-mono text-[13px] font-semibold text-foreground truncate">
          {entity.name}
        </span>
        {entity.exported && (
          <span className="text-[9px] font-semibold uppercase tracking-widest text-emerald-400/60">
            export
          </span>
        )}
        {isHighRisk && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20"
            title={`This function is called by ${entity.fan_in ?? 0} other functions and calls ${entity.fan_out ?? 0} — changes here have wide blast radius`}
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            High Risk
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="font-mono text-[10px] text-white/15 tabular-nums">
            L:{entity.line}
          </span>
          <Link
            href={`/repos/${repoId}/entities/${entity.id}`}
            className="flex items-center gap-1 text-[9px] text-white/20 hover:text-[#00E5FF]/70 transition-colors"
          >
            <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>
      </div>

      {/* ── Classification row: taxonomy + confidence (immediately visible) ── */}
      {j && (
        <div className="flex items-center gap-2 px-4 pb-2">
          {taxonomy && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                TAXONOMY_BADGE[taxonomy] ?? ""
              }`}
              title={TAXONOMY_HINT[taxonomy] ?? ""}
            >
              {TAXONOMY_LABEL[taxonomy] ?? taxonomy}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                title="Override classification"
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          {conf && (
            <span className={`text-[10px] font-medium ${conf.className}`}>
              {conf.text}
            </span>
          )}
          {j.featureTag && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] bg-white/[0.04] text-white/50 border border-white/[0.06]">
              <Tag className="h-2.5 w-2.5" />
              {j.featureTag}
            </span>
          )}
        </div>
      )}

      {/* ── Confidence bar (thin visual) ── */}
      {j && <ConfidenceBar confidence={j.confidence} />}

      {/* ── Override correction editor ── */}
      {editing && (
        <div className="mx-3 mb-2.5 rounded-md bg-[#08080D] border border-primary/20 p-3 space-y-2 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/60">
              Override Classification
            </span>
            <button type="button" onClick={() => setEditing(false)} className="text-white/30 hover:text-white/60">
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] text-white/40">Taxonomy</label>
            <div className="flex gap-1.5">
              {(["VERTICAL", "HORIZONTAL", "UTILITY"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setOverrideTaxonomy(t)}
                  className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors ${
                    overrideTaxonomy === t
                      ? TAXONOMY_BADGE[t]
                      : "border-white/10 text-white/30 hover:border-white/20"
                  }`}
                >
                  {TAXONOMY_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-white/40">Feature Tag</label>
            <input
              type="text"
              value={overrideFeatureTag}
              onChange={(e) => setOverrideFeatureTag(e.target.value)}
              className="w-full h-7 rounded border border-white/10 bg-transparent px-2 text-xs text-foreground placeholder:text-white/20 focus:outline-none focus:border-primary/30"
              placeholder="e.g., payment-processing"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-white/40">Business Purpose</label>
            <input
              type="text"
              value={overridePurpose}
              onChange={(e) => setOverridePurpose(e.target.value)}
              className="w-full h-7 rounded border border-white/10 bg-transparent px-2 text-xs text-foreground placeholder:text-white/20 focus:outline-none focus:border-primary/30"
              placeholder="What does this entity do?"
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs bg-rail-fade hover:opacity-90"
              onClick={handleSaveOverride}
              disabled={saving}
            >
              {saving ? (
                <Spinner className="h-3 w-3" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Apply Correction
            </Button>
          </div>
        </div>
      )}

      {/* ── What does this do? (HERO — plain English, first thing you read) ── */}
      {j && (
        <div className="px-4 pb-2.5">
          <p className="text-[13px] text-foreground/90 leading-relaxed">
            {j.businessPurpose}
          </p>
        </div>
      )}

      {/* ── Code signature (secondary — developers can see the actual code) ── */}
      {entity.signature && (
        <div className="mx-3 mb-2.5 rounded-md bg-[#08080D] border border-white/[0.04] overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-1 border-b border-white/[0.04]">
            <Code2 className="h-2.5 w-2.5 text-white/20" />
            <span className="text-[9px] text-white/20 uppercase tracking-wider">
              Code
            </span>
          </div>
          <pre className="p-3 font-mono text-[12px] leading-relaxed text-white/65 whitespace-pre-wrap break-all">
            {entity.signature}
          </pre>
        </div>
      )}

      {/* ── Domain concepts + details ── */}
      {j ? (
        <div className="px-4 pb-3 space-y-2">
          {/* Domain concepts */}
          {j.domainConcepts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {j.domainConcepts.map((concept) => (
                <span
                  key={concept}
                  className="inline-flex items-center px-2 py-[3px] rounded-full text-[10px] font-medium bg-white/[0.03] text-white/45 border border-white/[0.06]"
                >
                  {concept}
                </span>
              ))}
            </div>
          )}

          {/* Model info (subtle) */}
          {j.modelTier && (
            <div className="flex items-center gap-1 text-[9px] text-white/15">
              <Gem className="h-2.5 w-2.5" />
              <span className="font-mono">
                Analyzed by {j.modelUsed ?? j.modelTier} model
              </span>
            </div>
          )}

          {/* Expand/collapse for deeper details */}
          {hasDetails && (
            <>
              <button
                type="button"
                onClick={onToggle}
                className="flex items-center gap-1.5 text-[11px] text-white/25 hover:text-white/50 transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {isExpanded ? "Less" : "Why was it classified this way?"}
              </button>

              {isExpanded && (
                <div className="space-y-3 pt-2 border-t border-white/[0.04] animate-fade-in">
                  {/* Reasoning — plain English explanation */}
                  {j.reasoning && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Brain className="h-3 w-3 text-white/20" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/25">
                          AI Reasoning
                        </span>
                      </div>
                      <p className="text-[12px] text-white/45 leading-relaxed pl-[18px]">
                        {j.reasoning}
                      </p>
                    </div>
                  )}

                  {/* Semantic triples — relationships */}
                  {j.semanticTriples && j.semanticTriples.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Layers className="h-3 w-3 text-white/20" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/25">
                          Relationships
                        </span>
                      </div>
                      <div className="space-y-1 pl-[18px] py-1.5 rounded-md bg-white/[0.015] border border-white/[0.03]">
                        {j.semanticTriples.map((t, i) => (
                          <SemanticTriple key={i} triple={t} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Architectural pattern */}
                  {j.architecturalPattern && (
                    <div className="flex items-center gap-2 pl-[18px]">
                      <span className="text-[10px] text-white/25">Pattern:</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono bg-[#8134CE]/10 text-[#8134CE]/70 border border-[#8134CE]/20">
                        {j.architecturalPattern}
                      </span>
                    </div>
                  )}

                  {/* Compliance tags */}
                  {j.complianceTags && j.complianceTags.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Shield className="h-3 w-3 text-white/20" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/25">
                          Compliance
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pl-[18px]">
                        {j.complianceTags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-amber-400/5 text-amber-400/60 border border-amber-400/15"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Blast radius (fan-in/fan-out) */}
                  {(entity.fan_in != null || entity.fan_out != null) && (
                    <div className="flex items-center gap-3 pl-[18px]">
                      <span className="text-[10px] text-white/25">Blast Radius:</span>
                      <span className="text-[10px] font-mono text-white/40">
                        {entity.fan_in ?? 0} callers
                      </span>
                      <span className="text-white/10">|</span>
                      <span className="text-[10px] font-mono text-white/40">
                        {entity.fan_out ?? 0} callees
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* No justification available */
        <div className="px-4 pb-3 flex items-center gap-2">
          <div className="h-[2px] flex-1 rounded-full bg-white/[0.03]" />
          <span className="text-[10px] text-white/15 italic">Awaiting analysis</span>
          <div className="h-[2px] flex-1 rounded-full bg-white/[0.03]" />
        </div>
      )}
    </div>
  )
}

/* ─── File Tree (internal) ──────────────────────────────── */

function FileTree({
  nodes,
  selectedPath,
  onSelect,
}: {
  nodes: TreeNode[]
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  return (
    <ul className="space-y-px">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === "dir" ? (
            <>
              <button
                type="button"
                onClick={() =>
                  setExpanded((e) => {
                    const next = new Set(e)
                    if (next.has(node.path)) next.delete(node.path)
                    else next.add(node.path)
                    return next
                  })
                }
                className="group flex items-center gap-1.5 w-full text-left px-2 py-1 rounded-md text-[13px] text-white/70 hover:bg-white/5 transition-colors"
              >
                <ChevronRight
                  className={`h-3 w-3 shrink-0 text-white/30 transition-transform ${expanded.has(node.path) ? "rotate-90" : ""}`}
                />
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-white/40" />
                <span className="truncate">{node.name}</span>
              </button>
              {expanded.has(node.path) && node.children && node.children.length > 0 && (
                <div className="ml-3 border-l border-white/5 pl-2">
                  <FileTree
                    nodes={node.children}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                  />
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              className={`flex items-center gap-1.5 w-full text-left px-2 py-1 rounded-md text-[13px] transition-colors ${
                selectedPath === node.path
                  ? "bg-[#00E5FF]/10 text-white"
                  : "text-white/50 hover:bg-white/5 hover:text-white/80"
              }`}
            >
              <FileCode
                className={`h-3.5 w-3.5 shrink-0 ${selectedPath === node.path ? "text-[#00E5FF]" : "text-white/30"}`}
              />
              <span className="truncate">{node.name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/* ─── Summary Stats Bar ─────────────────────────────────── */

function EntitySummaryBar({ entities }: { entities: AnnotatedEntity[] }) {
  const justified = entities.filter((e) => e.justification).length
  const taxonomyCounts = entities.reduce(
    (acc: Record<string, number>, e) => {
      const t = e.justification?.taxonomy
      if (t) acc[t] = (acc[t] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>
  )
  const avgConfidence =
    justified > 0
      ? entities.reduce((s: number, e) => s + (e.justification?.confidence ?? 0), 0) /
        justified
      : 0

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.06] bg-white/[0.01]">
      <span className="text-[10px] font-mono text-white/30 tabular-nums">
        {entities.length} entities
      </span>
      <span className="text-white/10">|</span>
      <span className="text-[10px] font-mono text-white/30 tabular-nums">
        {justified}/{entities.length} justified
      </span>
      {justified > 0 && (
        <>
          <span className="text-white/10">|</span>
          <span className="text-[10px] font-mono text-white/30 tabular-nums">
            avg {Math.round(avgConfidence * 100)}%
          </span>
        </>
      )}
      {Object.entries(taxonomyCounts).map(([tax, count]) => (
        <span
          key={tax}
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
            TAXONOMY_BADGE[tax] ?? ""
          }`}
        >
          {count} {TAXONOMY_LABEL[tax] ?? tax}
        </span>
      ))}
    </div>
  )
}

/* ─── Empty / Loading States ────────────────────────────── */

function EmptyFileState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="relative mb-6">
        <div className="absolute inset-0 blur-2xl bg-[#00E5FF]/5 rounded-full" />
        <Code2 className="relative h-12 w-12 text-white/[0.06]" />
      </div>
      <p className="font-grotesk text-sm font-semibold text-white/20 mb-1.5">
        Select a file to explore
      </p>
      <p className="text-xs text-white/10 max-w-[240px] leading-relaxed">
        Choose a file from the tree to see its code entities with AI-generated business
        justifications, classifications, and semantic analysis.
      </p>
    </div>
  )
}

function LoadingEntities() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-white/[0.06] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-[18px] w-10" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-[2px] w-full" />
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-8 w-3/4" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

function NoEntitiesState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <FileCode className="h-10 w-10 text-white/[0.06] mb-4" />
      <p className="font-grotesk text-sm font-semibold text-white/20 mb-1">
        No entities found
      </p>
      <p className="text-xs text-white/10">
        This file has no indexed code entities (functions, classes, etc.)
      </p>
    </div>
  )
}

/* ─── Main Component ────────────────────────────────────── */

export function AnnotatedCodeViewer({
  repoId,
  initialTree,
}: {
  repoId: string
  initialTree: TreeNode[]
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [entities, setEntities] = useState<AnnotatedEntity[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [fileFilter, setFileFilter] = useState("")

  const filteredTree = useMemo(() => {
    if (!fileFilter.trim()) return initialTree
    const lower = fileFilter.toLowerCase()
    function filterNodes(nodes: TreeNode[]): TreeNode[] {
      return nodes.reduce<TreeNode[]>((acc, node) => {
        if (node.type === "file") {
          if (
            node.name.toLowerCase().includes(lower) ||
            node.path.toLowerCase().includes(lower)
          ) {
            acc.push(node)
          }
        } else if (node.children) {
          const filtered = filterNodes(node.children)
          if (filtered.length > 0) acc.push({ ...node, children: filtered })
        }
        return acc
      }, [])
    }
    return filterNodes(initialTree)
  }, [initialTree, fileFilter])

  const sortedEntities = useMemo(
    () => [...entities].sort((a, b) => a.line - b.line),
    [entities]
  )

  async function onSelectFile(path: string) {
    setSelectedFile(path)
    setEntities([])
    setExpandedIds(new Set())
    setLoading(true)
    try {
      const res = await fetch(
        `/api/repos/${repoId}/entities?file=${encodeURIComponent(path)}&enrich=true`
      )
      const body = (await res.json()) as {
        data?: { entities?: AnnotatedEntity[] }
      }
      setEntities(body?.data?.entities ?? [])
    } finally {
      setLoading(false)
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleOverride(entityId: string, updated: EntityJustification) {
    setEntities((prev) =>
      prev.map((e) =>
        e.id === entityId ? { ...e, justification: updated } : e
      )
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Code Intelligence
        </p>
        {selectedFile && entities.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setExpandedIds((prev) =>
                prev.size === entities.length
                  ? new Set()
                  : new Set(entities.map((e) => e.id))
              )
            }
            className="text-[10px] text-white/25 hover:text-white/50 transition-colors"
          >
            {expandedIds.size === entities.length ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>

      <div
        className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/5 lg:grid-cols-[280px_1fr]"
        style={{ height: "70vh" }}
      >
        {/* ── File Tree Panel ── */}
        <div className="flex flex-col min-h-0 bg-[#0A0A0F]">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <Search className="h-3 w-3 text-white/30" />
            <input
              type="text"
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder="Filter files..."
              className="h-6 flex-1 bg-transparent text-xs text-foreground placeholder:text-white/30 focus:outline-none"
            />
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            {filteredTree.length > 0 ? (
              <FileTree
                nodes={filteredTree}
                selectedPath={selectedFile}
                onSelect={onSelectFile}
              />
            ) : (
              <p className="px-2 py-4 text-center text-xs text-white/30">
                No matching files.
              </p>
            )}
          </div>
        </div>

        {/* ── Annotated Entity Stream ── */}
        <div className="flex flex-col min-h-0 bg-[#0A0A0F]">
          {/* File header */}
          {selectedFile && (
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2">
              <FileCode className="h-3.5 w-3.5 text-[#00E5FF]/40" />
              <span className="font-mono text-xs text-white/50 truncate">
                {selectedFile}
              </span>
            </div>
          )}

          {/* Summary stats */}
          {selectedFile && !loading && sortedEntities.length > 0 && (
            <EntitySummaryBar entities={sortedEntities} />
          )}

          {/* Entity stream */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {!selectedFile ? (
              <EmptyFileState />
            ) : loading ? (
              <LoadingEntities />
            ) : sortedEntities.length === 0 ? (
              <NoEntitiesState />
            ) : (
              <div className="space-y-2.5 p-4">
                {sortedEntities.map((entity) => (
                  <EntityAnnotationCard
                    key={entity.id}
                    entity={entity}
                    repoId={repoId}
                    isExpanded={expandedIds.has(entity.id)}
                    onToggle={() => toggleExpand(entity.id)}
                    onOverride={handleOverride}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
