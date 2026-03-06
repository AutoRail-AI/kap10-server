import { revalidatePath } from "next/cache"
import { NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import { getActiveOrgId } from "@/lib/api/get-active-org"
import { getContainer } from "@/lib/di/container"
import { withAuth } from "@/lib/middleware/api-handler"
import { errorResponse, successResponse } from "@/lib/utils/api-response"
import { logger } from "@/lib/utils/logger"

const RESUMABLE_STATUSES = ["error", "ready", "embed_failed", "justify_failed"]
const VALID_PHASES = ["indexing", "embedding", "ontology", "justification", "graph_sync", "health_report"] as const
type ResumePhase = (typeof VALID_PHASES)[number]

/** Maps resume phase → Temporal workflow function name */
const PHASE_WORKFLOW: Record<ResumePhase, string> = {
  indexing: "indexRepoWorkflow",
  embedding: "embedRepoWorkflow",
  ontology: "discoverOntologyWorkflow",
  justification: "justifyRepoWorkflow",
  graph_sync: "syncLocalGraphWorkflow",
  health_report: "generateHealthReportWorkflow",
}

/** Maps resume phase → workflow ID prefix */
const PHASE_WORKFLOW_PREFIX: Record<ResumePhase, string> = {
  indexing: "index",
  embedding: "embed",
  ontology: "ontology",
  justification: "justify",
  graph_sync: "sync",
  health_report: "health",
}

/** Maps resume phase → repo status to set */
const PHASE_STATUS: Record<ResumePhase, string> = {
  indexing: "indexing",
  embedding: "embedding",
  ontology: "embedding",   // ontology is part of the embedding→ontology→justify chain
  justification: "justifying",
  graph_sync: "ready",     // graph sync runs in background, repo is usable
  health_report: "ready",  // health report runs in background, repo is usable
}

/** Maps resume phase → Temporal task queue */
const PHASE_QUEUE: Record<ResumePhase, "heavy-compute-queue" | "light-llm-queue"> = {
  indexing: "heavy-compute-queue",
  embedding: "light-llm-queue",
  ontology: "light-llm-queue",
  justification: "light-llm-queue",
  graph_sync: "light-llm-queue",
  health_report: "light-llm-queue",
}

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const path = req.nextUrl.pathname
  const match = path.match(/^\/api\/repos\/([^/]+)\/resume/)
  const repoId = match?.[1]
  if (!repoId) {
    return errorResponse("Repo ID required", 400)
  }

  const body = (await req.json()) as { phase?: string }
  const phase = body.phase as ResumePhase | undefined
  if (!phase || !VALID_PHASES.includes(phase)) {
    return errorResponse(
      `Invalid phase. Must be one of: ${VALID_PHASES.join(", ")}`,
      400,
    )
  }

  const orgId = await getActiveOrgId()
  if (!orgId) {
    logger.warn("Resume failed: no active organization", { userId, repoId })
    return errorResponse("No organization", 400)
  }

  const ctx = { userId, organizationId: orgId, repoId, phase }
  const container = getContainer()
  const repo = await container.relationalStore.getRepo(orgId, repoId)
  if (!repo) {
    logger.warn("Resume failed: repo not found", ctx)
    return errorResponse("Repo not found", 404)
  }
  if (!RESUMABLE_STATUSES.includes(repo.status)) {
    logger.warn("Resume failed: repo not in resumable state", {
      ...ctx,
      currentStatus: repo.status,
    })
    return errorResponse(
      `Repo in '${repo.status}' state cannot be resumed. Allowed: ${RESUMABLE_STATUSES.join(", ")}`,
      400,
    )
  }

  // Cancel any existing workflow for this repo before starting a new one
  const oldWorkflowId = repo.workflowId ?? `index-${orgId}-${repoId}`
  try {
    await container.workflowEngine.cancelWorkflow(oldWorkflowId)
    logger.info("Cancelled previous workflow", { ...ctx, oldWorkflowId })
  } catch {
    // may not be running
  }

  const prefix = PHASE_WORKFLOW_PREFIX[phase]
  const workflowId = `${prefix}-${orgId}-${repoId}-${Date.now()}`
  const runId = randomUUID()

  try {
    await container.relationalStore.createPipelineRun({
      id: runId,
      repoId,
      organizationId: orgId,
      workflowId,
      triggerType: "resume",
      triggerUserId: userId,
      pipelineType: phase,
    })

    const body2 = body as { phase?: string; resumeFromStep?: string }
    let workflowArgs: unknown[]
    if (phase === "indexing") {
      // Derive installationId and cloneUrl the same way reindex/retry routes do
      const installation = await container.relationalStore.getInstallation(orgId)
      const installationId = installation ? Number(installation.installationId) : undefined
      const cloneUrl = repo.fullName ? `https://github.com/${repo.fullName}.git` : undefined
      workflowArgs = [{
        orgId, repoId, runId,
        provider: repo.provider ?? "github",
        defaultBranch: repo.defaultBranch ?? "main",
        installationId,
        cloneUrl,
        resumeFromStep: body2.resumeFromStep,
      }]
    } else {
      workflowArgs = [{ orgId, repoId, runId }]
    }

    await container.workflowEngine.startWorkflow({
      workflowId,
      workflowFn: PHASE_WORKFLOW[phase],
      args: workflowArgs,
      taskQueue: PHASE_QUEUE[phase],
    })

    const newStatus = PHASE_STATUS[phase]
    await container.relationalStore.updateRepoStatus(repoId, {
      status: newStatus,
      workflowId,
      errorMessage: null,
    })

    logger.info("Resume started: workflow launched", {
      ...ctx,
      workflowId,
      newStatus,
      previousStatus: repo.status,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      "Resume failed: workflow start error",
      err instanceof Error ? err : undefined,
      { ...ctx, workflowId },
    )
    return errorResponse(message, 500)
  }

  revalidatePath("/repos")
  return successResponse({
    status: PHASE_STATUS[phase],
    workflowId,
    runId,
    phase,
  })
})
