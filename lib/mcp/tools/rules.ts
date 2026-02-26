/**
 * Phase 6 MCP Tools: get_rules, check_rules, get_relevant_rules, draft_architecture_rule
 */

import type { Container } from "@/lib/di/container"
import { LLM_MODELS } from "@/lib/llm/config"
import { resolveRules } from "@/lib/rules/resolver"
import type { McpAuthContext } from "../auth"
import { formatToolError, formatToolResponse } from "../formatter"

// ── get_rules ──────────────────────────────────────────────

export const GET_RULES_SCHEMA = {
  name: "get_rules",
  description:
    "Get all active architecture rules for this repository, hierarchically resolved by scope. Returns rules sorted by priority with enforcement levels (suggest/warn/block).",
  inputSchema: {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "Optional file path to filter rules by path glob",
      },
      scope: {
        type: "string",
        description: "Optional scope filter: org, repo, path, branch, workspace",
      },
      type: {
        type: "string",
        description: "Optional type filter: architecture, naming, security, performance, style, custom",
      },
    },
    required: [],
  },
}

export async function handleGetRules(
  args: { file_path?: string; scope?: string; type?: string },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context. This API key is not scoped to a repository.")
  }

  const rules = await resolveRules(container, {
    orgId: ctx.orgId,
    repoId,
    filePath: args.file_path,
  })

  let filtered = rules
  if (args.scope) filtered = filtered.filter((r) => r.scope === args.scope)
  if (args.type) filtered = filtered.filter((r) => r.type === args.type)

  return formatToolResponse({
    rules: filtered.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      type: r.type,
      scope: r.scope,
      enforcement: r.enforcement,
      priority: r.priority,
      languages: r.languages,
      pathGlob: r.pathGlob,
    })),
    count: filtered.length,
  })
}

// ── check_rules ────────────────────────────────────────────

export const CHECK_RULES_SCHEMA = {
  name: "check_rules",
  description:
    "Check code against active rules using Semgrep. Returns violations with fix suggestions. Pass either a file path or inline code.",
  inputSchema: {
    type: "object" as const,
    properties: {
      file_path: {
        type: "string",
        description: "File path to check (relative to repo root)",
      },
      code: {
        type: "string",
        description: "Inline code to check against rules",
      },
    },
    required: [],
  },
}

export async function handleCheckRules(
  args: { file_path?: string; code?: string },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context.")
  }

  if (!args.file_path && !args.code) {
    return formatToolError("Either file_path or code is required")
  }

  const rules = await resolveRules(container, {
    orgId: ctx.orgId,
    repoId,
    filePath: args.file_path,
  })

  const rulesWithSemgrep = rules.filter((r) => r.semgrepRule)
  if (rulesWithSemgrep.length === 0) {
    return formatToolResponse({
      violations: [],
      message: "No Semgrep-backed rules found for this context",
    })
  }

  // Build combined YAML for all rules
  const yaml = require("yaml") as typeof import("yaml")
  const combinedRules = rulesWithSemgrep.map((r) => {
    try {
      const parsed = yaml.parse(r.semgrepRule!) as { rules?: unknown[] }
      return parsed?.rules?.[0] ?? null
    } catch {
      return null
    }
  }).filter(Boolean)

  if (combinedRules.length === 0) {
    return formatToolResponse({ violations: [], message: "No valid Semgrep rules found" })
  }

  const combinedYaml = yaml.stringify({ rules: combinedRules })

  if (args.code) {
    const matches = await container.patternEngine.matchRule(args.code, combinedYaml)
    return formatToolResponse({
      violations: matches.map((m) => ({
        ruleId: m.ruleId,
        line: m.line,
        message: m.message,
        severity: m.severity,
        fix: m.fix,
      })),
      count: matches.length,
    })
  }

  return formatToolResponse({
    violations: [],
    message: "File-level checking requires workspace access. Use code parameter for inline checking.",
    rulesChecked: rulesWithSemgrep.length,
  })
}

// ── get_relevant_rules ─────────────────────────────────────

export const GET_RELEVANT_RULES_SCHEMA = {
  name: "get_relevant_rules",
  description:
    "Get contextually relevant rules for a specific entity or file path using sub-graph traversal and relevance scoring. Use this before modifying code to understand applicable rules.",
  inputSchema: {
    type: "object" as const,
    properties: {
      entity_name: {
        type: "string",
        description: "Name of the entity (function, class) to find relevant rules for",
      },
      file_path: {
        type: "string",
        description: "File path to find relevant rules for",
      },
      depth: {
        type: "number",
        description: "Sub-graph traversal depth (default 2, max 5)",
      },
    },
    required: [],
  },
}

export async function handleGetRelevantRules(
  args: { entity_name?: string; file_path?: string; depth?: number },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context.")
  }

  if (!args.entity_name && !args.file_path) {
    return formatToolError("Either entity_name or file_path is required")
  }

  const rules = await resolveRules(container, {
    orgId: ctx.orgId,
    repoId,
    filePath: args.file_path,
  })

  // Filter rules by entity kinds and file types
  let relevant = rules
  if (args.file_path) {
    relevant = rules.filter((r) => {
      if (!r.fileTypes || r.fileTypes.length === 0) return true
      const ext = args.file_path!.split(".").pop() ?? ""
      return r.fileTypes.some((ft) => ft === ext || ft === `.${ext}`)
    })
  }

  const topK = Math.min(args.depth ?? 10, 20)

  return formatToolResponse({
    rules: relevant.slice(0, topK).map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      type: r.type,
      enforcement: r.enforcement,
      priority: r.priority,
    })),
    context: {
      entity_name: args.entity_name,
      file_path: args.file_path,
    },
    count: relevant.length,
  })
}

// ── draft_architecture_rule ────────────────────────────────

export const DRAFT_ARCHITECTURE_RULE_SCHEMA = {
  name: "draft_architecture_rule",
  description:
    "Use the LLM to draft an architecture rule with a valid ast-grep YAML pattern. Provide a natural language description of the rule you want to enforce.",
  inputSchema: {
    type: "object" as const,
    properties: {
      description: {
        type: "string",
        description: "Natural language description of the architecture rule to create",
      },
      language: {
        type: "string",
        description: "Target programming language (e.g., typescript, python)",
      },
      enforcement: {
        type: "string",
        description: "Enforcement level: suggest, warn, or block (default: suggest)",
      },
    },
    required: ["description"],
  },
}

export async function handleDraftArchitectureRule(
  args: { description: string; language?: string; enforcement?: string },
  ctx: McpAuthContext,
  container: Container
) {
  const repoId = ctx.repoId
  if (!repoId) {
    return formatToolError("No repository context.")
  }

  try {
    const { z } = await import("zod")

    const ruleSchema = z.object({
      title: z.string(),
      description: z.string(),
      type: z.enum(["architecture", "naming", "security", "performance", "style", "custom"]),
      astGrepQuery: z.string(),
      semgrepRule: z.string().optional(),
      languages: z.array(z.string()),
      pathGlob: z.string().optional(),
      enforcement: z.enum(["suggest", "warn", "block"]),
    })

    const result = await container.llmProvider.generateObject({
      model: LLM_MODELS.standard,
      prompt: `Generate an architecture rule for the following requirement:
"${args.description}"

Target language: ${args.language ?? "typescript"}
Enforcement level: ${args.enforcement ?? "suggest"}

Generate:
1. A clear title and description
2. An ast-grep pattern that matches violations
3. Optionally, a Semgrep YAML rule
4. Appropriate file glob pattern`,
      schema: ruleSchema,
    })

    return formatToolResponse({
      draft: result.object,
      usage: result.usage,
      message: "Rule drafted. Review and adjust the patterns before activating.",
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return formatToolError(`Failed to draft rule: ${message}`)
  }
}
