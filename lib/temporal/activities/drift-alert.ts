/**
 * Phase 5: Drift alert activity.
 * Evaluates if an entity change represents intent drift and alerts stakeholders.
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"
import type { DriftAlert, EntityDoc } from "@/lib/ports/types"

export interface DriftEvaluationInput {
  orgId: string
  repoId: string
  entityKey: string
  workspacePath?: string
}

export interface DriftEvaluationResult {
  isDrift: boolean
  alert?: DriftAlert
}

/**
 * Evaluate if an entity change represents a meaningful intent drift.
 * Uses LLM to compare old vs new business purpose.
 * If drift is detected and the entity has enough callers, generate an alert.
 */
export async function driftEvaluationActivity(input: DriftEvaluationInput): Promise<DriftEvaluationResult> {
  const container = getContainer()
  heartbeat("evaluating drift")

  const driftEnabled = process.env.DRIFT_ALERT_ENABLED !== "false"
  if (!driftEnabled) return { isDrift: false }

  const callerThreshold = parseInt(process.env.DRIFT_ALERT_CALLER_THRESHOLD ?? "10", 10)
  const channel = (process.env.DRIFT_ALERT_CHANNEL ?? "dashboard") as DriftAlert["channel"]

  // Get current entity
  const entity = await container.graphStore.getEntity(input.orgId, input.entityKey)
  if (!entity) return { isDrift: false }

  // Get previous justification
  const oldJustification = await container.graphStore.getJustification(input.orgId, input.entityKey)
  if (!oldJustification) return { isDrift: false }

  // Get new justification (most recent)
  const history = await container.graphStore.getJustificationHistory(input.orgId, input.entityKey)
  const newJustification = history[0]
  if (!newJustification || newJustification.id === oldJustification.id) return { isDrift: false }

  // Use LLM to evaluate if the change represents intent drift
  heartbeat("LLM drift evaluation")
  try {
    const result = await container.llmProvider.generateObject({
      schema: {
        parse: (v: unknown) => v as { isDrift: boolean; explanation: string },
      },
      prompt: `Compare these two business purpose descriptions for the same code entity and determine if the intent has fundamentally changed (drift):

Entity: ${entity.name} (${entity.kind}) in ${entity.file_path}

OLD purpose: ${oldJustification.business_purpose}
NEW purpose: ${newJustification.business_purpose}

Return isDrift=true only if the fundamental intent/role has changed, not just refinements or rewording.`,
      model: (require("@/lib/llm/config") as typeof import("@/lib/llm/config")).LLM_MODELS.standard,
    })

    if (!result.object.isDrift) return { isDrift: false }

    // Check caller count threshold
    const callers = await container.graphStore.getCallersOf(input.orgId, input.entityKey)
    if (callers.length < callerThreshold) return { isDrift: false }

    // Build caller details with blame info
    const affectedCallers: DriftAlert["affectedCallers"] = []
    for (const caller of callers.slice(0, 20)) {
      let author: string | undefined
      if (input.workspacePath) {
        const startLine = caller.start_line as number | undefined
        if (startLine) {
          author = (await container.gitHost.blame(input.workspacePath, caller.file_path, startLine)) ?? undefined
        }
      }
      affectedCallers.push({
        name: caller.name,
        filePath: caller.file_path,
        author,
      })
    }

    const alert: DriftAlert = {
      entityKey: input.entityKey,
      entityName: entity.name,
      oldPurpose: oldJustification.business_purpose,
      newPurpose: newJustification.business_purpose,
      affectedCallers,
      channel,
    }

    return { isDrift: true, alert }
  } catch (error: unknown) {
    console.error("Drift evaluation failed:", error instanceof Error ? error.message : String(error))
    return { isDrift: false }
  }
}
