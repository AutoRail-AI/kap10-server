/**
 * Phase 6 MCP Tools: check_patterns, get_conventions, suggest_approach
 */

import type { Container } from "@/lib/di/container"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

// ── check_patterns ──────────────────────────────────────────

export const CHECK_PATTERNS_SCHEMA = {
  name: "check_patterns",
  description:
    "Detect patterns in code using ast-grep structural search. Returns detected patterns with adherence rates and evidence.",
  inputSchema: {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "File path to check for patterns",
      },
      language: {
        type: "string",
        description: "Programming language (default: typescript)",
      },
      pattern_type: {
        type: "string",
        description: "Filter by pattern type: structural, naming, error-handling, import, testing",
      },
    },
    required: [],
  },
}

export async function handleCheckPatterns(
  args: { file_path?: string; language?: string; pattern_type?: string },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context.")
  }

  const patterns = await container.graphStore.queryPatterns(ctx.orgId, {
    orgId: ctx.orgId,
    repoId,
    status: "confirmed",
    type: args.pattern_type as "structural" | "naming" | "error-handling" | "import" | "testing" | undefined,
    limit: 50,
  })

  return formatToolResponse({
    patterns: patterns.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      adherenceRate: p.adherenceRate,
      confidence: p.confidence,
      language: p.language,
      evidence: p.evidence?.slice(0, 5),
      astGrepQuery: p.astGrepQuery,
    })),
    count: patterns.length,
    context: {
      file_path: args.file_path,
      language: args.language ?? "typescript",
    },
  })
}

// ── get_conventions ─────────────────────────────────────────

export const GET_CONVENTIONS_SCHEMA = {
  name: "get_conventions",
  description:
    "Get a formatted guide of all detected conventions and patterns for this repository. Use this before writing new code to understand existing patterns.",
  inputSchema: {
    type: "object" as const,
    properties: {
      language: {
        type: "string",
        description: "Filter conventions by language",
      },
    },
    required: [],
  },
}

export async function handleGetConventions(
  args: { language?: string },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context.")
  }

  const [patterns, rules] = await Promise.all([
    container.graphStore.queryPatterns(ctx.orgId, {
      orgId: ctx.orgId,
      repoId,
      status: "confirmed",
      language: args.language,
      limit: 50,
    }),
    container.graphStore.queryRules(ctx.orgId, {
      orgId: ctx.orgId,
      repoId,
      status: "active",
      language: args.language,
      limit: 50,
    }),
  ])

  // Format as a convention guide
  const sections: string[] = []

  if (rules.length > 0) {
    sections.push("## Architecture Rules\n")
    for (const rule of rules) {
      const badge = rule.enforcement === "block" ? "[MUST]" : rule.enforcement === "warn" ? "[SHOULD]" : "[MAY]"
      sections.push(`- ${badge} **${rule.title}**: ${rule.description}`)
    }
  }

  if (patterns.length > 0) {
    sections.push("\n## Detected Conventions\n")
    for (const pattern of patterns) {
      const rate = Math.round(pattern.adherenceRate * 100)
      sections.push(`- **${pattern.title}** (${rate}% adherence): ${pattern.type} pattern`)
    }
  }

  if (sections.length === 0) {
    sections.push("No conventions or rules detected yet. Run pattern detection to discover patterns.")
  }

  return formatToolResponse({
    guide: sections.join("\n"),
    rulesCount: rules.length,
    patternsCount: patterns.length,
    language: args.language,
  })
}

// ── suggest_approach ────────────────────────────────────────

export const SUGGEST_APPROACH_SCHEMA = {
  name: "suggest_approach",
  description:
    "Get context-aware suggestions for implementing a task based on existing patterns, rules, and code conventions in this repository.",
  inputSchema: {
    type: "object" as const,
    properties: {
      task: {
        type: "string",
        description: "Description of the task or feature to implement",
      },
      file_path: {
        type: "string",
        description: "Target file path where code will be added/modified",
      },
    },
    required: ["task"],
  },
}

export async function handleSuggestApproach(
  args: { task: string; file_path?: string },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context.")
  }

  // Gather context: rules, patterns, and nearby entities
  const [rules, patterns] = await Promise.all([
    container.graphStore.queryRules(ctx.orgId, {
      orgId: ctx.orgId,
      repoId,
      status: "active",
      limit: 20,
    }),
    container.graphStore.queryPatterns(ctx.orgId, {
      orgId: ctx.orgId,
      repoId,
      status: "confirmed",
      limit: 20,
    }),
  ])

  // Get entities in the target file if specified
  let fileEntities: Array<{ name: string; kind: string }> = []
  if (args.file_path) {
    const entities = await container.graphStore.getEntitiesByFile(ctx.orgId, repoId, args.file_path)
    fileEntities = entities.map((e) => ({ name: e.name, kind: e.kind }))
  }

  const suggestions: string[] = []

  // Rule-based suggestions
  const blockingRules = rules.filter((r) => r.enforcement === "block")
  if (blockingRules.length > 0) {
    suggestions.push("**Mandatory rules to follow:**")
    for (const r of blockingRules) {
      suggestions.push(`- ${r.title}: ${r.description}`)
    }
  }

  // Pattern-based suggestions
  const highConfidence = patterns.filter((p) => p.confidence > 0.8)
  if (highConfidence.length > 0) {
    suggestions.push("\n**Established patterns to follow:**")
    for (const p of highConfidence.slice(0, 5)) {
      suggestions.push(`- ${p.title} (${Math.round(p.adherenceRate * 100)}% adherence)`)
    }
  }

  // File context
  if (fileEntities.length > 0) {
    suggestions.push(`\n**Existing entities in ${args.file_path}:** ${fileEntities.map((e) => `${e.name} (${e.kind})`).join(", ")}`)
  }

  return formatToolResponse({
    task: args.task,
    suggestions: suggestions.join("\n"),
    rules_to_follow: rules.length,
    patterns_detected: patterns.length,
    file_entities: fileEntities.length,
  })
}
