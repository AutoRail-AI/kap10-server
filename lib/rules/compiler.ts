/**
 * Rule Compiler — uses LLM generateObject() with Zod schema to draft rules.
 */

import type { Container } from "@/lib/di/container"
import { z } from "zod"

const DraftedRuleSchema = z.object({
  title: z.string(),
  description: z.string(),
  type: z.enum(["architecture", "naming", "security", "performance", "style", "custom"]),
  astGrepQuery: z.string(),
  semgrepRule: z.string().optional(),
  languages: z.array(z.string()),
  pathGlob: z.string().optional(),
  enforcement: z.enum(["suggest", "warn", "block"]),
})

export type DraftedRule = z.infer<typeof DraftedRuleSchema>

export async function draftArchitectureRule(
  container: Container,
  description: string,
  language = "typescript",
  enforcement = "suggest"
): Promise<{ rule: DraftedRule; usage: { inputTokens: number; outputTokens: number } }> {
  const result = await container.llmProvider.generateObject({
    model: "claude-sonnet-4-20250514",
    prompt: `You are a code architecture expert. Generate a rule definition for the following requirement:

Requirement: "${description}"
Target language: ${language}
Enforcement level: ${enforcement}

Generate:
1. A clear, concise title
2. A detailed description explaining what the rule enforces and why
3. The rule type (architecture/naming/security/performance/style/custom)
4. An ast-grep pattern query that detects violations
5. Optionally, a Semgrep YAML rule for more complex detection
6. Applicable languages
7. A file glob pattern if the rule only applies to specific paths`,
    schema: DraftedRuleSchema,
  })

  return {
    rule: result.object,
    usage: result.usage,
  }
}
