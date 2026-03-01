/**
 * Anti-pattern rule synthesis Temporal activity.
 * Triggered after a rewind — analyzes reverted entries and generates an anti-pattern rule
 * using LLM, then stores it in ArangoDB rules collection.
 */

import { getContainer } from "@/lib/di/container"
import { LLM_MODELS } from "@/lib/llm/config"

interface AntiPatternInput {
  orgId: string
  repoId: string
  rewindEntryId: string
  revertedEntryIds: string[]
  branch: string
}

interface AntiPatternRule {
  name: string
  description: string
  pattern: string
  severity: "low" | "medium" | "high"
  category: string
  fix_suggestion: string
}

export async function synthesizeAntiPatternRule(input: AntiPatternInput): Promise<{ ruleId: string } | null> {
  const container = getContainer()

  // 1. Fetch reverted entries to understand what went wrong
  const revertedPrompts: string[] = []
  const revertedChanges: Array<{ file_path: string; change_type: string }> = []

  for (const entryId of input.revertedEntryIds) {
    const entry = await container.graphStore.getLedgerEntry(input.orgId, entryId)
    if (entry) {
      revertedPrompts.push(entry.prompt)
      for (const change of entry.changes) {
        revertedChanges.push({ file_path: change.file_path, change_type: change.change_type })
      }
    }
  }

  if (revertedPrompts.length === 0) return null

  // 2. Generate anti-pattern rule via LLM
  const { z } = require("zod") as typeof import("zod")
  const AntiPatternRuleSchema = z.object({
    name: z.string(),
    description: z.string(),
    pattern: z.string(),
    severity: z.enum(["low", "medium", "high"]),
    category: z.string(),
    fix_suggestion: z.string(),
  })

  const prompt = `Analyze the following AI-generated code changes that were reverted (rolled back) by the user.
Generate an anti-pattern rule that describes what went wrong so future AI assistants can avoid the same mistake.

Reverted prompts:
${revertedPrompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Files affected:
${revertedChanges.map((c) => `- ${c.file_path} (${c.change_type})`).join("\n")}

Generate a concise anti-pattern rule with name, description, pattern (code pattern to watch for), severity, category, and fix_suggestion.`

  try {
    const { object: rule, usage } = await container.llmProvider.generateObject<AntiPatternRule>({
      model: LLM_MODELS.standard,
      prompt,
      schema: AntiPatternRuleSchema,
    })

    // 3. Store rule in ArangoDB
    const crypto = require("node:crypto") as typeof import("node:crypto")
    const ruleId = crypto.randomUUID()

    const now = new Date().toISOString()
    await container.graphStore.upsertRule(input.orgId, {
      id: ruleId,
      org_id: input.orgId,
      repo_id: input.repoId,
      name: rule.name,
      title: rule.name,
      description: `${rule.description}\n\nPattern: ${rule.pattern}\nFix: ${rule.fix_suggestion}`,
      type: "custom" as const,
      scope: "repo" as const,
      enforcement: rule.severity === "high" ? "block" as const : rule.severity === "medium" ? "warn" as const : "suggest" as const,
      priority: rule.severity === "high" ? 90 : rule.severity === "medium" ? 60 : 30,
      status: "active" as const,
      astGrepQuery: rule.pattern,
      createdBy: "anti-pattern-synthesis",
      created_at: now,
      updated_at: now,
    })

    // 4. D-03: Close rewind → rule tracing loop — mark ledger entry with generated rule
    await container.graphStore.markLedgerEntryRuleGenerated(input.orgId, input.rewindEntryId, ruleId)

    // 5. Log token usage
    await container.graphStore.logTokenUsage(input.orgId, {
      id: crypto.randomUUID(),
      org_id: input.orgId,
      repo_id: input.repoId,
      model: LLM_MODELS.standard,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      activity: "anti-pattern-synthesis",
      created_at: new Date().toISOString(),
    })

    // 6. I-01: Create entity warnings for affected entities — mine negative knowledge
    try {
      // Find entities in affected files to attach warnings to
      const affectedEntityIds: string[] = []
      for (const change of revertedChanges) {
        const fileEntities = await container.graphStore.getEntitiesByFile(
          input.orgId,
          input.repoId,
          change.file_path
        )
        for (const e of fileEntities) {
          affectedEntityIds.push(e.id)
        }
      }

      if (affectedEntityIds.length > 0) {
        const warnings: import("@/lib/ports/types").EntityWarningDoc[] = affectedEntityIds.slice(0, 50).map((entityId) => ({
          id: `${ruleId}-${entityId}`.slice(0, 36),
          org_id: input.orgId,
          repo_id: input.repoId,
          entity_id: entityId,
          rule_id: ruleId,
          severity: rule.severity === "high" ? "error" as const : rule.severity === "medium" ? "warning" as const : "info" as const,
          message: `Previous AI change reverted: ${rule.name}`,
          reason: rule.description,
          ledger_entry_id: input.rewindEntryId,
          reverted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }))
        await container.graphStore.bulkUpsertEntityWarnings(input.orgId, warnings)
      }
    } catch {
      // Entity warning creation is best-effort — don't fail the rule synthesis
    }

    return { ruleId }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[anti-pattern] Synthesis failed: ${message}`)
    return null
  }
}

/**
 * Anti-pattern vectorization activity — embeds rule and finds matching entities.
 * Chained after synthesis.
 */
export async function vectorizeAntiPatternRule(input: {
  orgId: string
  repoId: string
  ruleId: string
  ruleName: string
  ruleDescription: string
}): Promise<{ matchCount: number }> {
  const container = getContainer()

  try {
    // 1. Embed the rule description
    const textContent = `${input.ruleName}: ${input.ruleDescription}`
    const embeddings = await container.vectorSearch.embed([textContent])
    if (embeddings.length === 0 || !embeddings[0]) return { matchCount: 0 }

    // 2. Search for matching entities (cosine > 0.75, max 20)
    const matches = await container.vectorSearch.search(embeddings[0], 20, {
      orgId: input.orgId,
      repoId: input.repoId,
    })

    const relevantMatches = matches.filter((m) => m.score > 0.75)

    // 3. Store the rule embedding in pgvector
    const _crypto = require("node:crypto") as typeof import("node:crypto")
    await container.vectorSearch.upsert(
      [`rule:${input.ruleId}`],
      [embeddings[0]],
      [{
        orgId: input.orgId,
        repoId: input.repoId,
        ruleId: input.ruleId,
        type: "anti-pattern-rule",
      }]
    )

    return { matchCount: relevantMatches.length }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[anti-pattern] Vectorization failed: ${message}`)
    return { matchCount: 0 }
  }
}
