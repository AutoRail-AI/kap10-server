"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { ArrowRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PipelineStepper } from "@/components/repo/pipeline-stepper"
import { PipelineLogViewer } from "@/components/repo/pipeline-log-viewer"
import { WhatsHappeningPanel } from "@/components/repo/whats-happening-panel"
import { useRepoStatus } from "@/hooks/use-repo-status"
import { usePipelineLogs } from "@/hooks/use-pipeline-logs"

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
  fullName,
  errorMessage,
}: RepoOnboardingConsoleProps) {
  const router = useRouter()
  const { status, progress } = useRepoStatus(repoId, initialStatus, initialProgress)
  const isActive = ["indexing", "embedding", "justifying", "ontology", "pending"].includes(status)
  const isError = ERROR_STATUSES.includes(status)
  const isReady = status === "ready"
  const { logs } = usePipelineLogs(repoId, isActive || isError || isReady)
  const [retrying, setRetrying] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const prevStatusRef = useRef(initialStatus)

  // Detect transition to ready
  useEffect(() => {
    if (status === "ready" && prevStatusRef.current !== "ready") {
      setShowCelebration(true)
    }
    prevStatusRef.current = status
  }, [status])

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await fetch(`/api/repos/${repoId}/retry`, { method: "POST" })
      router.refresh()
    } finally {
      setRetrying(false)
    }
  }

  const handleViewBlueprint = () => {
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {/* Pipeline Stepper */}
      <PipelineStepper status={status} progress={progress} />

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
            <Button
              size="sm"
              className="bg-rail-fade hover:opacity-90 mt-4"
              onClick={handleViewBlueprint}
            >
              View Codebase Blueprint
              <ArrowRight className="ml-2 h-3.5 w-3.5" />
            </Button>
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
            <WhatsHappeningPanel status={status} progress={progress} logs={logs} />
          </div>
        </div>
      )}
    </div>
  )
}
