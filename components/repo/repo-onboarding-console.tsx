"use client"

import { ArrowRight, ChevronDown, ChevronRight, FileDown, FileText, RotateCcw, RefreshCw, Save, Square } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { PipelineLogViewer } from "@/components/repo/pipeline-log-viewer"
import { PipelineStepper } from "@/components/repo/pipeline-stepper"
import { WhatsHappeningPanel } from "@/components/repo/whats-happening-panel"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { usePipelineLogs } from "@/hooks/use-pipeline-logs"
import { useRepoEvents } from "@/hooks/use-repo-events"
import { useRepoStatus } from "@/hooks/use-repo-status"
import type { PipelineStepRecord } from "@/lib/ports/types"

interface RepoOnboardingConsoleProps {
  repoId: string
  initialStatus: string
  initialProgress: number
  repoName: string
  fullName: string
  errorMessage?: string | null
}

const ERROR_STATUSES = ["error", "embed_failed", "justify_failed"]

// ── Resume Point Definitions ────────────────────────────────────────────────
// Each resume point maps to a backend phase and lists the pipeline steps that
// must be completed before this resume point becomes available.

interface ResumePoint {
  phase: string              // Backend phase key (sent to /api/repos/.../resume)
  label: string              // Human-friendly label
  description: string        // Explains what re-runs from this point
  prerequisiteSteps: string[] // Steps that must be completed/skipped
}

const RESUME_POINTS: ResumePoint[] = [
  {
    phase: "embedding",
    label: "From Embedding",
    description: "Re-generate vector embeddings, then re-run ontology & justification",
    prerequisiteSteps: ["clone", "wipe", "scip", "parse", "finalize"],
  },
  {
    phase: "ontology",
    label: "From Ontology",
    description: "Re-discover domain ontology, then re-run justification",
    prerequisiteSteps: ["clone", "wipe", "scip", "parse", "finalize", "embed"],
  },
  {
    phase: "justification",
    label: "From Justification",
    description: "Re-justify all entities with business context",
    prerequisiteSteps: ["clone", "wipe", "scip", "parse", "finalize", "embed", "ontology"],
  },
  {
    phase: "graph_sync",
    label: "From Graph Sync",
    description: "Re-export and sync the graph snapshot",
    prerequisiteSteps: ["clone", "wipe", "scip", "parse", "finalize"],
  },
  {
    phase: "health_report",
    label: "From Health Report",
    description: "Re-generate the codebase health report",
    prerequisiteSteps: ["clone", "wipe", "scip", "parse", "finalize", "embed", "ontology", "justification"],
  },
]

/** Returns resume points whose prerequisites are satisfied by completed steps. */
function getAvailableResumePoints(steps: PipelineStepRecord[]): ResumePoint[] {
  const completedSteps = new Set(
    steps
      .filter((s) => s.status === "completed" || s.status === "skipped")
      .map((s) => s.name),
  )
  return RESUME_POINTS.filter((rp) =>
    rp.prerequisiteSteps.every((step) => completedSteps.has(step)),
  )
}

export function RepoOnboardingConsole({
  repoId,
  initialStatus,
  initialProgress,
  repoName,
  fullName: _fullName,
  errorMessage,
}: RepoOnboardingConsoleProps) {
  const router = useRouter()
  const { status, progress, setStatus, indexingStartedAt, currentRunId, steps } = useRepoStatus(repoId, initialStatus, initialProgress)
  const isActive = ["indexing", "embedding", "justifying", "ontology", "pending"].includes(status)
  const isError = ERROR_STATUSES.includes(status)
  const isReady = status === "ready"
  const { logs } = usePipelineLogs(repoId, isActive || isError || isReady, currentRunId)
  const [retrying, setRetrying] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const prevStatusRef = useRef(initialStatus)
  const [contextOpen, setContextOpen] = useState(false)
  const [contextText, setContextText] = useState("")
  const [contextSaved, setContextSaved] = useState(false)
  const [contextSaving, setContextSaving] = useState(false)
  const contextLoaded = useRef(false)

  // SSE for real-time updates during active pipeline
  const { status: sseStatus, logs: _sseLogs } = useRepoEvents(repoId, { enabled: isActive })

  // Sync SSE status into local state — but guard against premature terminal states.
  // The embed workflow temporarily sets status to "ready" before ontology/justification
  // start, which causes the UI to flicker (celebration shows, then disappears). SSE is
  // great for fast intermediate updates (indexing→embedding→ontology), but terminal
  // states ("ready", errors) should only come from the polling hook which also fetches
  // step data for confirmation.
  useEffect(() => {
    if (!sseStatus) return
    const incoming = sseStatus.status
    // Terminal states: let polling handle these — it brings step data for validation
    if (incoming === "ready" || ERROR_STATUSES.includes(incoming)) return
    setStatus(incoming)
  }, [sseStatus, setStatus])

  // Load existing context documents on mount
  useEffect(() => {
    if (contextLoaded.current) return
    contextLoaded.current = true
    fetch(`/api/repos/${repoId}/context`)
      .then((r) => r.json())
      .then((json) => {
        const doc = (json as { data?: { contextDocuments?: string | null } })?.data?.contextDocuments
        if (doc) {
          setContextText(doc)
          setContextSaved(true)
        }
      })
      .catch(() => {})
  }, [repoId])

  const handleSaveContext = useCallback(async () => {
    setContextSaving(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/context`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: contextText }),
      })
      if (res.ok) {
        setContextSaved(true)
      }
    } finally {
      setContextSaving(false)
    }
  }, [repoId, contextText])

  // Detect transition to ready
  useEffect(() => {
    if (status === "ready" && prevStatusRef.current !== "ready") {
      setShowCelebration(true)
    }
    prevStatusRef.current = status
  }, [status])

  const handleStop = async () => {
    if (stopping) return
    setStopping(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/stop`, { method: "POST" })
      if (res.ok) {
        setStatus("error")
      }
    } finally {
      setStopping(false)
    }
  }

  const handleRetry = async () => {
    setRetrying(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/retry`, { method: "POST" })
      if (res.ok) {
        setStatus("indexing")
        toast.success("Pipeline retry started")
      } else if (res.status === 429) {
        toast.error("Rate limited — max 3 retries per hour. Try again later.")
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(body.error ?? `Retry failed (${res.status})`)
      }
    } catch {
      toast.error("Network error — could not reach the server.")
    } finally {
      setRetrying(false)
    }
  }

  const handleResume = async (phase: string) => {
    setResuming(true)
    try {
      const res = await fetch(`/api/repos/${repoId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase }),
      })
      if (res.ok) {
        const statusMap: Record<string, string> = {
          embedding: "embedding",
          ontology: "ontology",
          justification: "justifying",
          graph_sync: "ready",
          health_report: "ready",
        }
        setStatus(statusMap[phase] ?? "indexing")
        toast.success(`Pipeline resumed from ${phase.replace("_", " ")}`)
      } else if (res.status === 429) {
        toast.error("Rate limited — max 3 retries per hour. Try again later.")
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(body.error ?? `Resume failed (${res.status})`)
      }
    } catch {
      toast.error("Network error — could not reach the server.")
    } finally {
      setResuming(false)
    }
  }

  // Compute which resume points are available based on completed steps
  const availableResumePoints = useMemo(() => getAvailableResumePoints(steps), [steps])

  const handleViewBlueprint = () => {
    // Navigate to the repo page — layout re-renders with ready status
    router.push(`/repos/${repoId}`)
  }

  return (
    <div className="space-y-4">
      {/* Stop button when processing */}
      {isActive && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={handleStop}
            disabled={stopping}
          >
            {stopping ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <Square className="h-3 w-3" />
            )}
            Stop Pipeline
          </Button>
        </div>
      )}

      {/* Context Seeding — visible before justification completes */}
      {["pending", "indexing", "embedding"].includes(status) && (
        <div className="rounded-lg border border-white/10 bg-white/[0.015] overflow-hidden">
          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
          >
            {contextOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-white/30" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-white/30" />
            )}
            <FileText className="h-3.5 w-3.5 text-primary/60" />
            <span className="text-xs font-medium text-foreground">Context Seeding</span>
            <span className="text-[10px] text-muted-foreground ml-1">
              — Provide docs to anchor AI classifications
            </span>
            {contextSaved && (
              <span className="ml-auto text-[10px] text-emerald-400/70">Saved</span>
            )}
          </button>
          {contextOpen && (
            <div className="px-4 pb-4 space-y-2 border-t border-white/[0.06]">
              <p className="text-[11px] text-muted-foreground pt-2">
                Paste your ARCHITECTURE.md, PRD, or project description. This context anchors
                the AI&apos;s feature tags and business purpose classifications to your team&apos;s vocabulary.
              </p>
              <textarea
                value={contextText}
                onChange={(e) => {
                  setContextText(e.target.value)
                  setContextSaved(false)
                }}
                placeholder="Paste your ARCHITECTURE.md, PRD, or project description here..."
                className="w-full h-32 rounded-md border border-white/10 bg-[#08080D] px-3 py-2 text-xs text-foreground font-mono placeholder:text-white/20 focus:outline-none focus:border-primary/30 resize-y"
                maxLength={10000}
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/20 font-mono">
                  {contextText.length.toLocaleString()} / 10,000 chars
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10"
                  onClick={handleSaveContext}
                  disabled={contextSaving || contextSaved}
                >
                  {contextSaving ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  {contextSaved ? "Saved" : "Save Context"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pipeline Stepper */}
      <PipelineStepper status={status} progress={progress} steps={steps} />

      {/* Error state */}
      {isError && (
        <div className="glass-card border-destructive/30 rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Pipeline Error</p>
              <p className="text-xs text-muted-foreground">
                {errorMessage ?? `The pipeline encountered an error during ${status.replace("_", " ")}.`}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/30 text-destructive hover:bg-destructive/10"
                  disabled={retrying || resuming}
                >
                  {retrying || resuming ? (
                    <Spinner className="mr-2 h-3.5 w-3.5" />
                  ) : (
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  )}
                  Restart
                  <ChevronDown className="ml-1.5 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem onClick={handleRetry} className="flex items-start gap-2 py-2">
                  <RefreshCw className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium">Full Pipeline</p>
                    <p className="text-[10px] text-muted-foreground">Start fresh from clone & scan</p>
                  </div>
                </DropdownMenuItem>
                {availableResumePoints.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
                      Resume from stage
                    </p>
                    {availableResumePoints.map((rp) => (
                      <DropdownMenuItem
                        key={rp.phase}
                        onClick={() => handleResume(rp.phase)}
                        className="flex items-start gap-2 py-2"
                      >
                        <RotateCcw className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-medium">{rp.label}</p>
                          <p className="text-[10px] text-muted-foreground">{rp.description}</p>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* Failed step detail — show which granular step failed */}
          {steps.some((s) => s.status === "failed") && (
            <div className="rounded-md bg-destructive/5 border border-destructive/10 px-3 py-2">
              {steps
                .filter((s) => s.status === "failed")
                .map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                    <span className="text-[11px] text-destructive/80">
                      Failed at <span className="font-medium text-destructive">{s.label}</span>
                      {s.errorMessage && (
                        <span className="text-destructive/60"> — {s.errorMessage.length > 120 ? s.errorMessage.slice(0, 120) + "…" : s.errorMessage}</span>
                      )}
                      {s.durationMs != null && (
                        <span className="text-destructive/40 ml-1">({Math.round(s.durationMs / 1000)}s)</span>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Celebration */}
      {showCelebration && (
        <div className="celebration-container glass-card border-emerald-500/30 rounded-lg border p-6 text-center relative overflow-hidden">
          <div className="celebration-pop relative z-10">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/30 mb-3">
              <svg className="h-6 w-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-grotesk text-base font-semibold text-foreground">
              Your codebase blueprint is ready!
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {repoName} has been fully indexed and analyzed.
            </p>
            <div className="flex items-center gap-2 mt-4">
              <Button
                size="sm"
                className="bg-rail-fade hover:opacity-90"
                onClick={handleViewBlueprint}
              >
                View Codebase Blueprint
                <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Button>
              <a href={`/api/repos/${repoId}/export/context`} download>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/20 text-muted-foreground hover:text-foreground"
                >
                  <FileDown className="mr-2 h-3.5 w-3.5" />
                  Download Intelligence Report
                </Button>
              </a>
            </div>
          </div>
          {/* Particle-like decorations */}
          <div className="celebration-particle celebration-particle-1" />
          <div className="celebration-particle celebration-particle-2" />
          <div className="celebration-particle celebration-particle-3" />
        </div>
      )}

      {/* Console + Analytics grid */}
      {!showCelebration && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <PipelineLogViewer repoId={repoId} status={status} />
          </div>
          <div className="lg:col-span-1">
            <WhatsHappeningPanel status={status} progress={progress} logs={logs} steps={steps} indexingStartedAt={indexingStartedAt} errorMessage={errorMessage} />
          </div>
        </div>
      )}
    </div>
  )
}
