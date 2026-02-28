/**
 * Pipeline run tracking activities — manages PipelineRun records in PostgreSQL.
 *
 * Three activities on light-llm-queue:
 *   - initPipelineRun: Creates run record + initializes steps as pending
 *   - updatePipelineStep: Updates a single step status (read-modify-write)
 *   - completePipelineRun: Finalizes the run with status, metrics, and duration
 */

import { getContainer } from "@/lib/di/container"
import type { PipelineStepName, PipelineStepRecord } from "@/lib/ports/types"
import { logger } from "@/lib/utils/logger"

const INITIAL_STEPS: PipelineStepRecord[] = [
  { name: "clone", label: "Preparing workspace", status: "pending" },
  { name: "wipe", label: "Clearing previous data", status: "pending" },
  { name: "scip", label: "Running SCIP indexers", status: "pending" },
  { name: "parse", label: "Parsing remaining files", status: "pending" },
  { name: "finalize", label: "Finalizing index", status: "pending" },
  { name: "embed", label: "Generating embeddings", status: "pending" },
  { name: "graphSync", label: "Syncing graph snapshot", status: "pending" },
  { name: "patternDetection", label: "Detecting patterns", status: "pending" },
]

export interface InitPipelineRunInput {
  runId: string
  orgId: string
  repoId: string
  workflowId?: string
  temporalRunId?: string
  triggerType: string
  pipelineType?: string
  indexVersion?: string
}

export async function initPipelineRun(input: InitPipelineRunInput): Promise<void> {
  const log = logger.child({
    service: "pipeline-run",
    organizationId: input.orgId,
    repoId: input.repoId,
    runId: input.runId,
  })

  try {
    const container = getContainer()
    await container.relationalStore.createPipelineRun({
      id: input.runId,
      repoId: input.repoId,
      organizationId: input.orgId,
      workflowId: input.workflowId,
      triggerType: input.triggerType,
      pipelineType: input.pipelineType ?? "full",
      indexVersion: input.indexVersion,
      steps: INITIAL_STEPS,
    })

    // If we have a temporalRunId, save it immediately
    if (input.temporalRunId) {
      await container.relationalStore.updatePipelineRun(input.runId, {
        temporalRunId: input.temporalRunId,
      })
    }

    log.info("Pipeline run initialized", { triggerType: input.triggerType })
  } catch (error: unknown) {
    log.warn("Failed to initialize pipeline run", {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    // Best-effort — don't fail the pipeline over tracking
  }
}

export interface UpdatePipelineStepInput {
  runId: string
  stepName: PipelineStepName
  status: PipelineStepRecord["status"]
  errorMessage?: string
}

export async function updatePipelineStep(input: UpdatePipelineStepInput): Promise<void> {
  const log = logger.child({ service: "pipeline-run", runId: input.runId })
  try {
    const container = getContainer()
    const run = await container.relationalStore.getPipelineRun(input.runId)
    if (!run) {
      log.warn("Pipeline run not found, cannot update step", { stepName: input.stepName })
      return
    }

    const steps = [...run.steps]
    const step = steps.find((s) => s.name === input.stepName)
    if (!step) {
      log.warn("Step not found in pipeline run", { stepName: input.stepName, availableSteps: steps.map((s) => s.name) })
      return
    }

    const now = new Date().toISOString()
    step.status = input.status
    if (input.status === "running") {
      step.startedAt = now
    }
    if (input.status === "completed" || input.status === "failed") {
      step.completedAt = now
      if (step.startedAt) {
        step.durationMs = new Date(now).getTime() - new Date(step.startedAt).getTime()
      }
    }
    if (input.errorMessage) {
      step.errorMessage = input.errorMessage
    }

    await container.relationalStore.updatePipelineRun(input.runId, { steps })
    log.info("Pipeline step updated", { stepName: input.stepName, status: input.status, durationMs: step.durationMs })
  } catch (error: unknown) {
    log.warn("Failed to update pipeline step", {
      stepName: input.stepName,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}

export interface CompletePipelineRunInput {
  runId: string
  status: "completed" | "failed" | "cancelled"
  errorMessage?: string
  fileCount?: number
  functionCount?: number
  classCount?: number
  entitiesWritten?: number
  edgesWritten?: number
}

export async function completePipelineRun(input: CompletePipelineRunInput): Promise<void> {
  const log = logger.child({ service: "pipeline-run", runId: input.runId })
  try {
    const container = getContainer()
    const run = await container.relationalStore.getPipelineRun(input.runId)
    if (!run) {
      log.warn("Pipeline run not found, cannot complete", { status: input.status })
      return
    }

    const completedAt = new Date()
    const durationMs = completedAt.getTime() - run.startedAt.getTime()

    await container.relationalStore.updatePipelineRun(input.runId, {
      status: input.status,
      completedAt,
      durationMs,
      errorMessage: input.errorMessage ?? null,
      fileCount: input.fileCount ?? null,
      functionCount: input.functionCount ?? null,
      classCount: input.classCount ?? null,
      entitiesWritten: input.entitiesWritten ?? null,
      edgesWritten: input.edgesWritten ?? null,
    })
    log.info("Pipeline run completed", {
      status: input.status,
      durationMs,
      fileCount: input.fileCount,
      functionCount: input.functionCount,
      classCount: input.classCount,
      ...(input.errorMessage && { errorMessage: input.errorMessage }),
    })
  } catch (error: unknown) {
    log.warn("Failed to complete pipeline run", {
      status: input.status,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}
