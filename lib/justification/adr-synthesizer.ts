/**
 * Phase 4: ADR Synthesizer — auto-generates Architecture Decision Records
 * from feature aggregations using LLM analysis.
 */

import type { ILLMProvider } from "@/lib/ports/llm-provider"
import type { FeatureAggregation, JustificationDoc, ADRDoc } from "@/lib/ports/types"
import { randomUUID } from "node:crypto"
import { z } from "zod"

const ADRResponseSchema = z.object({
  title: z.string(),
  context: z.string(),
  decision: z.string(),
  consequences: z.string(),
})

/**
 * Synthesize ADRs from feature aggregations.
 * Groups justifications by feature area and generates ADR markdown.
 */
export async function synthesizeADRs(
  features: FeatureAggregation[],
  justifications: JustificationDoc[],
  llmProvider: ILLMProvider,
  orgId: string,
  repoId: string
): Promise<ADRDoc[]> {
  const adrs: ADRDoc[] = []
  const defaultModel = process.env.LLM_DEFAULT_MODEL ?? "gpt-4o-mini"

  // Only synthesize ADRs for features with 3+ entities (meaningful features)
  const significantFeatures = features.filter((f) => f.entity_count >= 3)

  for (const feature of significantFeatures.slice(0, 10)) {
    const featureJustifications = justifications.filter(
      (j) => j.feature_tag === feature.feature_tag
    )

    const prompt = buildADRPrompt(feature, featureJustifications)

    try {
      const result = await llmProvider.generateObject({
        model: defaultModel,
        schema: ADRResponseSchema,
        prompt,
        temperature: 0.3,
      })

      adrs.push({
        id: randomUUID(),
        org_id: orgId,
        repo_id: repoId,
        feature_area: feature.feature_tag,
        title: result.object.title,
        context: result.object.context,
        decision: result.object.decision,
        consequences: result.object.consequences,
        generated_at: new Date().toISOString(),
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[adr-synthesizer] Failed for ${feature.feature_tag}: ${message}`)
    }
  }

  return adrs
}

function buildADRPrompt(
  feature: FeatureAggregation,
  justifications: JustificationDoc[]
): string {
  const entityList = justifications
    .slice(0, 15)
    .map((j) => `  - [${j.taxonomy}] ${j.entity_id}: ${j.business_purpose}`)
    .join("\n")

  const triples = justifications
    .flatMap((j) => j.semantic_triples)
    .slice(0, 10)
    .map((t) => `  - ${t.subject} → ${t.predicate} → ${t.object}`)
    .join("\n")

  return `Generate an Architecture Decision Record (ADR) for the following feature area.

## Feature: ${feature.feature_tag}
- Entity count: ${feature.entity_count}
- Taxonomy breakdown: VERTICAL=${feature.taxonomy_breakdown["VERTICAL"] ?? 0}, HORIZONTAL=${feature.taxonomy_breakdown["HORIZONTAL"] ?? 0}, UTILITY=${feature.taxonomy_breakdown["UTILITY"] ?? 0}
- Average confidence: ${feature.average_confidence.toFixed(2)}

## Entities
${entityList}

## Semantic Relationships
${triples || "  (none extracted)"}

## Task
Generate an ADR with:
- "title": A concise title for this architectural decision
- "context": What problem or need led to this feature area existing?
- "decision": What architectural approach was taken and why?
- "consequences": What are the trade-offs, risks, and benefits?

Focus on business and architectural reasoning, not implementation details.`
}
