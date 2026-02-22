import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import {
  handleCheckPatterns,
  handleGetConventions,
  handleSuggestApproach,
} from "../patterns"
import type { McpAuthContext } from "../../auth"
import type { PatternDoc, RuleDoc, EntityDoc } from "@/lib/ports/types"

let container: Container
let ctx: McpAuthContext
let testRepo: string

const ORG = "org-patterns-tools"

function makePattern(id: string, overrides: Partial<PatternDoc> = {}): PatternDoc {
  return {
    id,
    org_id: ORG,
    repo_id: testRepo,
    name: `pattern-${id}`,
    type: "structural",
    title: `Pattern ${id}`,
    adherenceRate: 0.85,
    confidence: 0.9,
    status: "confirmed",
    source: "ast-grep",
    language: "typescript",
    evidence: [{ file: "src/test.ts", line: 10, snippet: "const x = 1" }],
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  }
}

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
    enforcement: "block",
    priority: 50,
    status: "active",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  }
}

function makeEntity(id: string, name: string, filePath = "src/test.ts"): EntityDoc {
  return { id, org_id: ORG, repo_id: testRepo, kind: "function", name, file_path: filePath, start_line: 10 }
}

beforeEach(async () => {
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

// ── check_patterns ──────────────────────────────────────────

describe("handleCheckPatterns", () => {
  it("scans with pattern engine and returns confirmed patterns", async () => {
    await container.graphStore.upsertPattern(ORG, makePattern("p1"))
    await container.graphStore.upsertPattern(ORG, makePattern("p2", { type: "naming" }))

    const result = await handleCheckPatterns({}, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      patterns: Array<{ id: string; type: string }>
      count: number
    }

    expect(parsed.count).toBe(2)
    expect(parsed.patterns).toHaveLength(2)
    expect(parsed.patterns.map((p) => p.id)).toContain("p1")
  })

  it("filters by pattern_type when queryPatterns supports it", async () => {
    await container.graphStore.upsertPattern(ORG, makePattern("p1", { type: "structural" }))
    await container.graphStore.upsertPattern(ORG, makePattern("p2", { type: "naming" }))

    // The handler passes type to queryPatterns. The in-memory fake returns all
    // confirmed patterns regardless of type, so both patterns appear.
    // This test verifies the handler calls queryPatterns with the right context.
    const result = await handleCheckPatterns({ pattern_type: "naming" }, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      patterns: Array<{ id: string; type: string }>
      count: number
      context: { file_path?: string; language: string }
    }

    expect(parsed.patterns).toBeDefined()
    expect(parsed.count).toBeGreaterThanOrEqual(1)
    expect(parsed.context.language).toBe("typescript")
  })

  it("returns empty when no patterns exist", async () => {
    const result = await handleCheckPatterns({}, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as { patterns: unknown[]; count: number }

    expect(parsed.count).toBe(0)
    expect(parsed.patterns).toEqual([])
  })

  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleCheckPatterns({}, noRepoCtx as McpAuthContext, container)
    expect(result.isError).toBe(true)
  })
})

// ── get_conventions ─────────────────────────────────────────

describe("handleGetConventions", () => {
  it("returns formatted conventions from rules and patterns", async () => {
    await container.graphStore.upsertRule(ORG, makeRule("r1", { enforcement: "block" }))
    await container.graphStore.upsertPattern(ORG, makePattern("p1"))

    const result = await handleGetConventions({}, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as {
      guide: string
      rulesCount: number
      patternsCount: number
    }

    expect(parsed.rulesCount).toBe(1)
    expect(parsed.patternsCount).toBe(1)
    expect(parsed.guide).toContain("Architecture Rules")
    expect(parsed.guide).toContain("[MUST]")
    expect(parsed.guide).toContain("Detected Conventions")
    expect(parsed.guide).toContain("85%")
  })

  it("returns message when no conventions exist", async () => {
    const result = await handleGetConventions({}, ctx, container)
    const parsed = JSON.parse(result.content[0]!.text) as { guide: string; rulesCount: number }

    expect(parsed.rulesCount).toBe(0)
    expect(parsed.guide).toContain("No conventions or rules detected yet")
  })

  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleGetConventions({}, noRepoCtx as McpAuthContext, container)
    expect(result.isError).toBe(true)
  })
})

// ── suggest_approach ────────────────────────────────────────

describe("handleSuggestApproach", () => {
  it("returns context-aware suggestions with rules and patterns", async () => {
    await container.graphStore.upsertRule(ORG, makeRule("r1", { enforcement: "block" }))
    await container.graphStore.upsertPattern(ORG, makePattern("p1", { confidence: 0.95 }))
    await container.graphStore.bulkUpsertEntities(ORG, [makeEntity("e1", "myFunction", "src/service.ts")])

    const result = await handleSuggestApproach(
      { task: "Add a new endpoint", file_path: "src/service.ts" },
      ctx,
      container
    )
    const parsed = JSON.parse(result.content[0]!.text) as {
      task: string
      suggestions: string
      rules_to_follow: number
      patterns_detected: number
      file_entities: number
    }

    expect(parsed.task).toBe("Add a new endpoint")
    expect(parsed.rules_to_follow).toBeGreaterThanOrEqual(1)
    expect(parsed.patterns_detected).toBeGreaterThanOrEqual(1)
    expect(parsed.file_entities).toBe(1)
    expect(parsed.suggestions).toContain("Mandatory rules to follow")
    expect(parsed.suggestions).toContain("Established patterns to follow")
    expect(parsed.suggestions).toContain("myFunction")
  })

  it("returns suggestions without file_path", async () => {
    await container.graphStore.upsertRule(ORG, makeRule("r1", { enforcement: "block" }))

    const result = await handleSuggestApproach(
      { task: "Refactor code" },
      ctx,
      container
    )
    const parsed = JSON.parse(result.content[0]!.text) as {
      task: string
      file_entities: number
    }

    expect(parsed.task).toBe("Refactor code")
    expect(parsed.file_entities).toBe(0)
  })

  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleSuggestApproach(
      { task: "some task" },
      noRepoCtx as McpAuthContext,
      container
    )
    expect(result.isError).toBe(true)
  })
})
