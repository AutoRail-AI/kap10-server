/**
 * Summarizer — LLM narrative synthesis for ledger merge summaries.
 */

import { z } from "zod"
import { LLM_MODELS } from "@/lib/llm/config"
import type { ILLMProvider } from "@/lib/ports/llm-provider"

const SummarySchema = z.object({
  narrative: z.string().max(2000),
})

export async function summarizeLedger(
  llm: ILLMProvider,
  input: {
    prNumber: number
    sourceBranch: string
    targetBranch: string
    prompts: string[]
    entryCount: number
  }
): Promise<string> {
  const promptList = input.prompts.slice(0, 20).map((p, i) => `${i + 1}. ${p}`).join("\n")

  const result = await llm.generateObject({
    model: LLM_MODELS.standard,
    schema: SummarySchema,
    prompt: `Summarize the following AI coding session for a merge narrative.

PR #${input.prNumber}: ${input.sourceBranch} → ${input.targetBranch}
Total interactions: ${input.entryCount}

Prompts used during the session:
${promptList}

Write a concise narrative (2-3 sentences) describing what was accomplished during this coding session. Focus on the outcomes, not the individual steps. Write in past tense.`,
  })

  return result.object.narrative
}
