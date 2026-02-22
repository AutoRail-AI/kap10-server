/**
 * generateAdrWorkflow — Auto-generate Architecture Decision Records on significant merges.
 */

import { proxyActivities } from "@temporalio/workflow"
import type * as activities from "../activities/adr-generation"

const act = proxyActivities<typeof activities>({
  startToCloseTimeout: "120s",
  retry: { maximumAttempts: 3 },
})

export interface GenerateAdrInput {
  orgId: string
  repoId: string
  prNumber: number
  prTitle: string
  mergedBy: string
  owner: string
  repo: string
  installationId: number
  headSha: string
}

export async function generateAdrWorkflow(input: GenerateAdrInput): Promise<{ adrPrNumber?: number; adrPrUrl?: string; skipped?: boolean; reason?: string }> {
  // Activity 1: Assess merge significance
  const assessment = await act.assessMergeSignificance({
    orgId: input.orgId,
    repoId: input.repoId,
    prNumber: input.prNumber,
  })

  if (!assessment.significant) {
    return { skipped: true, reason: assessment.reason }
  }

  // Activity 2: Generate ADR via LLM
  const adrContent = await act.generateAdr({
    orgId: input.orgId,
    repoId: input.repoId,
    prNumber: input.prNumber,
    prTitle: input.prTitle,
    assessment,
  })

  // Activity 3: Commit ADR as follow-up PR
  const result = await act.commitAdrPr({
    orgId: input.orgId,
    repoId: input.repoId,
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    installationId: input.installationId,
    headSha: input.headSha,
    adrContent,
  })

  return { adrPrNumber: result.prNumber, adrPrUrl: result.prUrl }
}
