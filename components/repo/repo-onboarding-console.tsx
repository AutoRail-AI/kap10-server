"use client"

import { ArrowRight, ChevronDown, ChevronRight, FileDown, FileText, RefreshCw, Save, Square } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { PipelineLogViewer } from "@/components/repo/pipeline-log-viewer"
import { PipelineStepper } from "@/components/repo/pipeline-stepper"
import { WhatsHappeningPanel } from "@/components/repo/whats-happening-panel"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { usePipelineLogs } from "@/hooks/use-pipeline-logs"
import { useRepoEvents } from "@/hooks/use-repo-events"
import { useRepoStatus } from "@/hooks/use-repo-status"

interface RepoOnboardingConsoleProps {
  repoId: string
  initialStatus: string
  initialProgress: number
  repoName: string
  fullName: string
  errorMessage?: string | null
}

const ERROR_STATUSES = ["error", "embed_failed", "justify_failed"]

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

  // Sync SSE status into local state
  useEffect(() => {
    if (sseStatus) {
      setStatus(sseStatus.status)
    }
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
      }
    } finally {
      setRetrying(false)
    }
  }

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
        <div className="glass-card border-destructive/30 rounded-lg border p-4 flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">Pipeline Error</p>
            <p className="text-xs text-muted-foreground">
              {errorMessage ?? `The pipeline encountered an error during ${status.replace("_", " ")}.`}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? (
              <Spinner className="mr-2 h-3.5 w-3.5" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Retry Pipeline
          </Button>
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
            <WhatsHappeningPanel status={status} progress={progress} logs={logs} indexingStartedAt={indexingStartedAt} />
          </div>
        </div>
      )}
    </div>
  )
}
