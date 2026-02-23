"use client"

import { Check, AlertCircle } from "lucide-react"

interface PipelineStepperProps {
  status: string
  progress: number
}

interface Stage {
  label: string
  description: string
}

const STAGES: Stage[] = [
  { label: "Cloning", description: "Fetching repository from GitHub..." },
  { label: "Indexing", description: "Analyzing code structure with SCIP..." },
  { label: "Embedding", description: "Generating semantic embeddings..." },
  { label: "Analyzing", description: "Running business justification..." },
  { label: "Ready", description: "Your codebase blueprint is ready!" },
]

const ERROR_STATUSES = ["error", "embed_failed", "justify_failed"]

function getActiveStageIndex(status: string, progress: number): number {
  if (status === "ready") return 4
  if (status === "embedding") return 2
  if (status === "ontology" || status === "justifying") return 3
  if (status === "embed_failed") return 2
  if (status === "justify_failed") return 3
  if (status === "error") return progress < 20 ? 0 : 1
  // pending/indexing — use progress to distinguish clone vs index
  if (progress < 20) return 0
  return 1
}

export function PipelineStepper({ status, progress }: PipelineStepperProps) {
  const activeIndex = getActiveStageIndex(status, progress)
  const isError = ERROR_STATUSES.includes(status)
  const isReady = status === "ready"

  return (
    <div className="glass-card border-border rounded-lg border p-6">
      <div className="flex items-center justify-between">
        {STAGES.map((stage, i) => {
          const isCompleted = isReady ? true : i < activeIndex
          const isActive = i === activeIndex
          const isStageError = isActive && isError

          return (
            <div key={stage.label} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center gap-1.5">
                {/* Circle */}
                <div
                  className={`
                    flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-medium transition-all
                    ${isCompleted
                      ? "border-emerald-500 bg-emerald-500 text-background"
                      : isStageError
                        ? "border-destructive bg-destructive/10 text-destructive animate-pulse"
                        : isActive
                          ? "border-electric-cyan bg-electric-cyan/10 text-electric-cyan shadow-[0_0_12px_rgba(0,229,255,0.3)] animate-pulse"
                          : "border-border bg-background text-muted-foreground"
                    }
                  `}
                >
                  {isCompleted ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : isStageError ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : (
                    i + 1
                  )}
                </div>
                {/* Label */}
                <span
                  className={`font-grotesk text-xs font-medium whitespace-nowrap ${
                    isCompleted
                      ? "text-emerald-500"
                      : isStageError
                        ? "text-destructive"
                        : isActive
                          ? "text-electric-cyan"
                          : "text-muted-foreground"
                  }`}
                >
                  {stage.label}
                </span>
                {/* Description (active stage only) */}
                {isActive && (
                  <span className={`text-[10px] max-w-[120px] text-center ${isStageError ? "text-destructive/80" : "text-muted-foreground"}`}>
                    {isStageError ? "Pipeline encountered an error" : stage.description}
                  </span>
                )}
              </div>
              {/* Connecting line */}
              {i < STAGES.length - 1 && (
                <div
                  className={`h-0.5 flex-1 mx-2 mt-[-24px] transition-colors ${
                    i < activeIndex ? "bg-emerald-500" : "bg-border"
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
