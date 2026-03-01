/**
 * TBI-I-04: Drift-as-documentation-trigger activity.
 * When drift is detected, proposes updated justification + ADR revision.
 * Creates a documentation proposal for developer review.
 */

import { heartbeat } from "@temporalio/activity"
import { randomUUID } from "node:crypto"
import { getContainer } from "@/lib/di/container"
import { logger } from "@/lib/utils/logger"

export interface DriftDocumentationInput {
  orgId: string
  repoId: string
  entityKey: string
  oldTaxonomy: string
  oldBusinessPurpose: string
  newTaxonomy: string
  newBusinessPurpose: string
}

export interface DocumentationProposal {
  id: string
  entity_id: string
  org_id: string
  repo_id: string
  old_taxonomy: string
  proposed_taxonomy: string
  old_business_purpose: string
  proposed_business_purpose: string
  adr_draft: string
  confidence: number
  status: "pending" | "accepted" | "rejected"
  created_at: string
}

export interface DriftDocumentationResult {
  proposalCreated: boolean
  proposalId?: string
}

/**
 * Propose documentation updates for entities that have drifted.
 * Re-runs justification LLM with explicit drift context, then generates an ADR draft.
 */
export async function proposeDriftDocumentation(
  input: DriftDocumentationInput
): Promise<DriftDocumentationResult> {
  const log = logger.child({ service: "drift-documentation", organizationId: input.orgId, repoId: input.repoId })
  const container = getContainer()

  heartbeat("fetching entity for drift documentation")

  const entity = await container.graphStore.getEntity(input.orgId, input.entityKey)
  if (!entity) {
    log.warn("Entity not found for drift documentation", { entityKey: input.entityKey })
    return { proposalCreated: false }
  }

  heartbeat("generating documentation proposal via LLM")

  let llmModel = "gemini-2.0-flash"
  try {
    const { LLM_MODELS } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")
    llmModel = LLM_MODELS.standard
  } catch {
    // Fallback
  }

  try {
    const { z } = require("zod") as typeof import("zod")
    const ProposalSchema = z.object({
      proposedTaxonomy: z.string(),
      proposedBusinessPurpose: z.string(),
      adrDraft: z.string(),
      confidence: z.number(),
      roleChanged: z.boolean(),
    })

    const bodySnippet = typeof entity.body === "string"
      ? entity.body.slice(0, 2000)
      : ""

    const result = await container.llmProvider.generateObject({
      model: llmModel,
      schema: ProposalSchema,
      prompt: `You are analyzing an entity whose role appears to have changed (architectural drift detected).

Entity: ${entity.name} (${entity.kind}) in ${entity.file_path}

PREVIOUS classification:
- Taxonomy: ${input.oldTaxonomy}
- Business Purpose: ${input.oldBusinessPurpose}

CURRENT classification (from latest re-justification):
- Taxonomy: ${input.newTaxonomy}
- Business Purpose: ${input.newBusinessPurpose}

Current code (first 2000 chars):
\`\`\`
${bodySnippet}
\`\`\`

Based on the current implementation:
1. Has this entity's role truly changed? (roleChanged)
2. What should its updated business purpose be? (proposedBusinessPurpose)
3. What taxonomy is most accurate now? (proposedTaxonomy: VERTICAL, HORIZONTAL, UTILITY, or FOUNDATIONAL)
4. Write a brief ADR (Architecture Decision Record) documenting this role change. (adrDraft)
5. How confident are you in this assessment? (confidence: 0.0 to 1.0)

The ADR should follow: "## Context\\n...\\n## Decision\\n...\\n## Consequences\\n..."`,
    })

    if (!result.object.roleChanged) {
      log.info("LLM determined no actual role change", { entityKey: input.entityKey })
      return { proposalCreated: false }
    }

    // Create documentation proposal
    const proposalId = randomUUID()
    const proposal: DocumentationProposal = {
      id: proposalId,
      entity_id: input.entityKey,
      org_id: input.orgId,
      repo_id: input.repoId,
      old_taxonomy: input.oldTaxonomy,
      proposed_taxonomy: result.object.proposedTaxonomy,
      old_business_purpose: input.oldBusinessPurpose,
      proposed_business_purpose: result.object.proposedBusinessPurpose,
      adr_draft: result.object.adrDraft,
      confidence: result.object.confidence,
      status: "pending",
      created_at: new Date().toISOString(),
    }

    // Store proposal in graph store (documentation_proposals collection)
    await container.graphStore.upsertDocumentationProposal(input.orgId, proposal)

    log.info("Documentation proposal created", {
      proposalId,
      entityKey: input.entityKey,
      oldTaxonomy: input.oldTaxonomy,
      proposedTaxonomy: result.object.proposedTaxonomy,
    })

    return { proposalCreated: true, proposalId }
  } catch (error: unknown) {
    log.warn("Failed to create documentation proposal", {
      entityKey: input.entityKey,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return { proposalCreated: false }
  }
}
