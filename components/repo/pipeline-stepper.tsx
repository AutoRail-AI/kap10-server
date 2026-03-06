"use client"

import { AlertCircle, Check } from "lucide-react"
import { useRef } from "react"
import type { PipelineStepRecord } from "@/lib/ports/types"

interface PipelineStepperProps {
  status: string
  progress: number
  steps?: PipelineStepRecord[]
}

interface Stage {
  label: string
  description: string
}

const STAGES: Stage[] = [
  { label: "Cloning",        description: "Fetching and preparing your repository..." },
  { label: "Scanning",       description: "Analyzing code structure and relationships..." },
  { label: "Mapping",        description: "Building the intelligence graph..." },
  { label: "Understanding",  description: "Discovering business context and purpose..." },
  { label: "Patterns",       description: "Detecting conventions and code patterns..." },
  { label: "Ready",          description: "Your codebase intelligence is ready!" },
]

const STAGE_READY = STAGES.length - 1

// Map each granular pipeline step to a high-level stage index.
const STEP_TO_STAGE: Record<string, number> = {
  clone:             0, // Cloning
  wipe:              0,
  scip:              1, // Scanning
  parse:             1,
  finalize:          1,
  blastRadius:       2, // Mapping
  temporalAnalysis:  2,
  embed:             2,
  ontology:          3, // Understanding
  justification:     3,
  graphSync:         4, // Patterns
  patternDetection:  4,
}

// Steps that the parent workflow marks "completed" immediately after *launching*
// the child workflow (fire-and-forget). Their "completed" status does NOT mean
// the actual work is done — the real work runs in a child workflow. Ignore these
// when computing active stage so the stepper doesn't jump ahead prematurely.
const FIRE_AND_FORGET_STEPS = new Set(["embed", "graphSync", "patternDetection"])

const ERROR_STATUSES = ["error", "embed_failed", "justify_failed"]

/**
 * Compute the active stage from granular step data.
 *
 * Strategy: walk steps in order and find the highest stage that has real
 * (non-fire-and-forget) progress. This avoids the backward-walk issue where
 * fire-and-forget steps at the end misleadingly show as "completed".
 */
function getActiveStageFromSteps(steps: PipelineStepRecord[]): number {
  let highestCompleted = -1
  let activeRunning = -1

  for (const step of steps) {
    const stage = STEP_TO_STAGE[step.name] ?? 0

    if (step.status === "running") {
      activeRunning = Math.max(activeRunning, stage)
    }

    if (step.status === "failed") {
      // Show the stage where failure occurred
      return stage
    }

    if (step.status === "completed" && !FIRE_AND_FORGET_STEPS.has(step.name)) {
      highestCompleted = Math.max(highestCompleted, stage)
    }
  }

  // A running step takes priority — it's the active stage
  if (activeRunning >= 0) return activeRunning

  // Otherwise advance one past the highest completed stage,
  // capped at STAGE_READY - 1 (Patterns) to avoid premature Ready
  if (highestCompleted >= 0) {
    return Math.min(highestCompleted + 1, STAGE_READY - 1)
  }

  return 0
}

/**
 * Derive the active UI stage index from available signals.
 *
 * Priority: steps data (most granular) → repo status (coarser) → progress (fallback).
 * The `status` field alone is unreliable — the embed workflow temporarily sets
 * status to "ready" before ontology/justification start, causing flicker.
 */
function getActiveStageIndex(status: string, progress: number, steps?: PipelineStepRecord[]): number {
  // Terminal states — use status directly
  if (ERROR_STATUSES.includes(status)) {
    // If we have steps, show the error at the right stage
    if (steps && steps.length > 0) {
      const failedStep = steps.find((s) => s.status === "failed")
      if (failedStep) return STEP_TO_STAGE[failedStep.name] ?? 0
    }
    if (status === "embed_failed") return 2
    if (status === "justify_failed") return 3
    return progress < 15 ? 0 : progress < 40 ? 1 : 2
  }

  // Use real step data when available — most reliable signal
  if (steps && steps.length > 0) {
    // Only trust "ready" as truly ready when ALL non-fire-and-forget steps are done
    const coreSteps = steps.filter((s) => !FIRE_AND_FORGET_STEPS.has(s.name))
    const allCoreDone = coreSteps.every((s) => s.status === "completed" || s.status === "skipped")
    if (allCoreDone && status === "ready") return STAGE_READY

    return getActiveStageFromSteps(steps)
  }

  // Fallback: derive from status/progress when step data is unavailable
  if (status === "ready") return STAGE_READY
  if (status === "embedding") return 2
  if (status === "ontology") return 3
  if (status === "justifying") return 3
  // pending/indexing — use progress to distinguish clone vs scan
  if (progress < 15) return 0
  if (progress < 40) return 1
  return 2
}

export function PipelineStepper({ status, progress, steps }: PipelineStepperProps) {
  const rawIndex = getActiveStageIndex(status, progress, steps)
  const isError = ERROR_STATUSES.includes(status)

  // Monotonic high-water mark — the stepper never goes backwards during a
  // single pipeline run. This prevents flicker from out-of-order status
  // updates (SSE vs polling race, embed setting "ready" prematurely, etc.).
  // Resets when an error occurs or a new run starts (progress drops to 0).
  const highWaterRef = useRef(0)
  if (isError || progress === 0) {
    highWaterRef.current = rawIndex
  } else {
    highWaterRef.current = Math.max(highWaterRef.current, rawIndex)
  }
  const activeIndex = highWaterRef.current

  const isReady = activeIndex === STAGE_READY && status === "ready"

  return (
    <div className="flex items-center gap-1 w-full">
      {STAGES.map((stage, i) => {
        const isCompleted = isReady ? true : i < activeIndex
        const isActive = i === activeIndex
        const isStageError = isActive && isError

        return (
          <div key={stage.label} className="flex items-center flex-1 last:flex-initial">
            <div className="flex items-center gap-1.5">
              {/* Circle */}
              <div
                className={`
                  flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-medium transition-all shrink-0
                  ${isCompleted
                    ? "border-emerald-500 bg-emerald-500 text-background"
                    : isStageError
                      ? "border-destructive bg-destructive/10 text-destructive animate-pulse"
                      : isActive
                        ? "border-electric-cyan bg-electric-cyan/10 text-electric-cyan shadow-[0_0_8px_rgba(0,229,255,0.25)]"
                        : "border-border bg-background text-muted-foreground"
                  }
                `}
              >
                {isCompleted ? (
                  <Check className="h-2.5 w-2.5" />
                ) : isStageError ? (
                  <AlertCircle className="h-2.5 w-2.5" />
                ) : (
                  i + 1
                )}
              </div>
              {/* Label */}
              <span
                className={`text-[11px] font-medium whitespace-nowrap hidden sm:inline ${
                  isCompleted
                    ? "text-emerald-500/70"
                    : isStageError
                      ? "text-destructive"
                      : isActive
                        ? "text-electric-cyan"
                        : "text-muted-foreground/60"
                }`}
              >
                {stage.label}
              </span>
            </div>
            {/* Connecting line */}
            {i < STAGES.length - 1 && (
              <div
                className={`h-px flex-1 mx-1.5 transition-colors ${
                  i < activeIndex ? "bg-emerald-500/50" : "bg-border"
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
