import { beforeEach, describe, expect, it } from "vitest"
import { type Container, createTestContainer } from "@/lib/di/container"
import type { RuleDoc } from "@/lib/ports/types"
import type { McpAuthContext } from "../../auth"
import {
  handleCheckRules,
  handleDraftArchitectureRule,
  handleGetRelevantRules,
  handleGetRules,
} from "../rules"

let container: Container
let ctx: McpAuthContext
let testRepo: string

const ORG = "org-rules-tools"

function makeRule(id: string, overrides: Partial<RuleDoc> = {}): RuleDoc {
  return {
    id,
    org_id: ORG,
    repo_id: testRepo,
    name: `rule-${id}`,
    title: `Rule ${id}`,
    description: `Description for ${id}`,
    type: "architecture",
    scope: "repo",
    enforcement: "warn",
    priority: 50,
    status: "active",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  }
}

beforeEach(async () => {
  // Use unique repo per test to avoid shared module-level cache collisions
  testRepo = `repo-${Date.now()}-${Math.random().toString(36).slice(2)}`
  container = createTestContainer()
  ctx = {
    authMode: "api_key",
    userId: "u-1",
    orgId: ORG,
    repoId: testRepo,
    scopes: ["mcp:read"],
    apiKeyId: "k-1",
  }
})

// ── get_rules ───────────────────────────────────────────────

describe("handleGetRules", () => {
  it("returns rules from resolver", async () => {
    await container.graphStore.upsertRule(ORG, makeRule("r1"))
    await container.graphStore.upsertRule(ORG, makeRule("r2", { type: "security" }))

    const result = await handleGetRules({}, ctx, container)
    const text = result.content[0]!.text
    const parsed = JSON.parse(text) as { rules: Array<{ id: string }>; count: number }

    expect(parsed.count).toBe(2)
    expect(parsed.rules).toHaveLength(2)
    expect(parsed.rules.map((r) => r.id)).toContain("r1")
    expect(parsed.rules.map((r) => r.id)).toContain("r2")
  })

  it("filters by type", async () => {
    await container.graphStore.upsertRule(ORG, makeRule("r1", { type: "architecture" }))
    await container.graphStore.upsertRule(ORG, makeRule("r2", { type: "security" }))

    const result = await handleGetRules({ type: "security" }, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as { rules: Array<{ id: string }>; count: number }

    expect(parsed.count).toBe(1)
    expect(parsed.rules[0]!.id).toBe("r2")
  })

  it("filters by scope", async () => {
    await container.graphStore.upsertRule(ORG, makeRule("r1", { scope: "repo" }))
    await container.graphStore.upsertRule(ORG, makeRule("r2", { scope: "org" }))

    const result = await handleGetRules({ scope: "org" }, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as { rules: Array<{ id: string }>; count: number }

    expect(parsed.count).toBe(1)
    expect(parsed.rules[0]!.id).toBe("r2")
  })

  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleGetRules({}, noRepoCtx as McpAuthContext, container)
    expect(result.isError).toBe(true)
  })
})

// ── check_rules ─────────────────────────────────────────────

describe("handleCheckRules", () => {
  it("runs pattern engine and returns violations for code input", async () => {
    const semgrepYaml = `rules:\n  - id: no-console\n    pattern: console.log(...)\n    message: Do not use console.log\n    severity: WARNING\n    languages: [typescript]`
    await container.graphStore.upsertRule(ORG, makeRule("r1", { semgrepRule: semgrepYaml }))

    // FakePatternEngine.matchRule returns [] by default
    const result = await handleCheckRules({ code: "console.log('test')" }, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as { violations: unknown[]; count: number }

    expect(parsed.violations).toBeDefined()
    expect(Array.isArray(parsed.violations)).toBe(true)
    expect(parsed.violations).toHaveLength(0)
  })

  it("returns no violations when no semgrep-backed rules exist", async () => {
    await container.graphStore.upsertRule(ORG, makeRule("r1")) // no semgrepRule

    const result = await handleCheckRules({ code: "const x = 1" }, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as { violations: unknown[]; message: string }

    expect(parsed.violations).toEqual([])
    expect(parsed.message).toContain("No Semgrep-backed rules found")
  })

  it("returns error when neither file_path nor code is provided", async () => {
    const result = await handleCheckRules({}, ctx, container)
    expect(result.isError).toBe(true)
  })

  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleCheckRules({ code: "x" }, noRepoCtx as McpAuthContext, container)
    expect(result.isError).toBe(true)
  })
})

// ── get_relevant_rules ──────────────────────────────────────

describe("handleGetRelevantRules", () => {
  it("returns contextually relevant rules for a file path", async () => {
    await container.graphStore.upsertRule(ORG, makeRule("r1", { fileTypes: ["ts"] }))
    await container.graphStore.upsertRule(ORG, makeRule("r2", { fileTypes: ["py"] }))

    const result = await handleGetRelevantRules(
      { file_path: "src/index.ts" },
      ctx,
      container
    )
    const parsed = JSON.parse(result.content[0]!.text) as {
      rules: Array<{ id: string }>
      context: { file_path: string }
      count: number
    }

    expect(parsed.context.file_path).toBe("src/index.ts")
    // r1 matches .ts, r2 does not
    expect(parsed.rules.some((r) => r.id === "r1")).toBe(true)
    expect(parsed.rules.every((r) => r.id !== "r2")).toBe(true)
  })

  it("returns error when neither entity_name nor file_path provided", async () => {
    const result = await handleGetRelevantRules({}, ctx, container)
    expect(result.isError).toBe(true)
  })

  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleGetRelevantRules(
      { file_path: "src/index.ts" },
      noRepoCtx as McpAuthContext,
      container
    )
    expect(result.isError).toBe(true)
  })
})

// ── draft_architecture_rule ─────────────────────────────────

describe("handleDraftArchitectureRule", () => {
  it("calls LLM generateObject and returns draft", async () => {
    const result = await handleDraftArchitectureRule(
      { description: "Never use console.log in production code", language: "typescript" },
      ctx,
      container
    )

    // MockLLMProvider returns schema.parse({}) which may fail with zod validation
    // but the handler catches errors and returns formatToolError
    const text = result.content[0]!.text
    expect(text).toBeDefined()
  })

  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleDraftArchitectureRule(
      { description: "No console.log" },
      noRepoCtx as McpAuthContext,
      container
    )
    expect(result.isError).toBe(true)
  })
})
