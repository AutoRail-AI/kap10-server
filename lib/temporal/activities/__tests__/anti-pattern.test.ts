import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import type { LedgerEntry } from "@/lib/ports/types"
import { MockLLMProvider } from "@/lib/di/fakes"

// Mock getContainer to return our test container
let testContainer: Container

vi.mock("@/lib/di/container", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/di/container")>()
  return {
    ...original,
    getContainer: () => testContainer,
  }
})

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    org_id: "org-1",
    repo_id: "repo-1",
    user_id: "user-1",
    branch: "main",
    timeline_branch: 1,
    prompt: "Test prompt",
    changes: [
      { file_path: "src/foo.ts", change_type: "modified", diff: "@@ -1 +1 @@", lines_added: 1, lines_removed: 0 },
    ],
    status: "pending",
    parent_id: null,
    rewind_target_id: null,
    commit_sha: null,
    snapshot_id: null,
    validated_at: null,
    rule_generated: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe("synthesizeAntiPatternRule", () => {
  let mockLlm: MockLLMProvider

  beforeEach(() => {
    mockLlm = new MockLLMProvider()
    testContainer = createTestContainer({ llmProvider: mockLlm })
  })

  it("generates an anti-pattern rule from reverted entries", async () => {
    // Override generateObject to return a realistic rule
    mockLlm.generateObject = async <T>(params: { schema: { parse: (v: unknown) => T } }): Promise<{ object: T; usage: { inputTokens: number; outputTokens: number } }> => {
      const rule = {
        name: "avoid-direct-db-access",
        description: "Do not access database directly in route handlers",
        pattern: "supabase.from(.*).select",
        severity: "medium" as const,
        category: "architecture",
        fix_suggestion: "Use the DI container's relationalStore port instead",
      }
      return {
        object: params.schema.parse(rule),
        usage: { inputTokens: 500, outputTokens: 200 },
      }
    }

    // Create reverted entries in the graph store
    await testContainer.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "reverted-1",
      prompt: "Add direct database query in route handler",
      changes: [
        { file_path: "app/api/users/route.ts", change_type: "modified", diff: "", lines_added: 10, lines_removed: 0 },
      ],
      status: "reverted",
    }))

    await testContainer.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "reverted-2",
      prompt: "Add inline SQL query",
      changes: [
        { file_path: "app/api/repos/route.ts", change_type: "modified", diff: "", lines_added: 5, lines_removed: 1 },
      ],
      status: "reverted",
    }))

    // Import and call the activity
    const { synthesizeAntiPatternRule } = await import("@/lib/temporal/activities/anti-pattern")

    const result = await synthesizeAntiPatternRule({
      orgId: "org-1",
      repoId: "repo-1",
      rewindEntryId: "rewind-entry-1",
      revertedEntryIds: ["reverted-1", "reverted-2"],
      branch: "main",
    })

    expect(result).not.toBeNull()
    expect(result!.ruleId).toBeTruthy()
  })

  it("stores the generated rule in graph store", async () => {
    let capturedRuleData: Record<string, unknown> | null = null

    // Track upsertRule calls
    const originalUpsertRule = testContainer.graphStore.upsertRule.bind(testContainer.graphStore)
    testContainer.graphStore.upsertRule = async (orgId: string, rule: Record<string, unknown>) => {
      capturedRuleData = rule
      return originalUpsertRule(orgId, rule)
    }

    mockLlm.generateObject = async <T>(params: { schema: { parse: (v: unknown) => T } }): Promise<{ object: T; usage: { inputTokens: number; outputTokens: number } }> => {
      return {
        object: params.schema.parse({
          name: "test-rule",
          description: "Test description",
          pattern: "test pattern",
          severity: "low",
          category: "test",
          fix_suggestion: "Test fix",
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      }
    }

    await testContainer.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "store-test-1",
      prompt: "Bad pattern",
      status: "reverted",
    }))

    const { synthesizeAntiPatternRule } = await import("@/lib/temporal/activities/anti-pattern")

    await synthesizeAntiPatternRule({
      orgId: "org-1",
      repoId: "repo-1",
      rewindEntryId: "rewind-store",
      revertedEntryIds: ["store-test-1"],
      branch: "main",
    })

    expect(capturedRuleData).not.toBeNull()
    expect(capturedRuleData!.createdBy).toBe("anti-pattern-synthesis")
    expect(capturedRuleData!.type).toBe("custom")
  })

  it("logs token usage after synthesis", async () => {
    mockLlm.generateObject = async <T>(params: { schema: { parse: (v: unknown) => T } }): Promise<{ object: T; usage: { inputTokens: number; outputTokens: number } }> => {
      return {
        object: params.schema.parse({
          name: "token-test",
          description: "desc",
          pattern: "pat",
          severity: "low",
          category: "cat",
          fix_suggestion: "fix",
        }),
        usage: { inputTokens: 300, outputTokens: 150 },
      }
    }

    await testContainer.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "token-entry-1",
      prompt: "Some bad change",
      status: "reverted",
    }))

    const { synthesizeAntiPatternRule } = await import("@/lib/temporal/activities/anti-pattern")

    await synthesizeAntiPatternRule({
      orgId: "org-1",
      repoId: "repo-1",
      rewindEntryId: "rewind-token",
      revertedEntryIds: ["token-entry-1"],
      branch: "main",
    })

    const usage = await testContainer.graphStore.getTokenUsage("org-1", "repo-1")
    const synthUsage = usage.find((u) => u.activity === "anti-pattern-synthesis")
    expect(synthUsage).toBeTruthy()
    expect(synthUsage!.input_tokens).toBe(300)
    expect(synthUsage!.output_tokens).toBe(150)
  })

  it("returns null when no reverted prompts found", async () => {
    const { synthesizeAntiPatternRule } = await import("@/lib/temporal/activities/anti-pattern")

    const result = await synthesizeAntiPatternRule({
      orgId: "org-1",
      repoId: "repo-1",
      rewindEntryId: "rewind-empty",
      revertedEntryIds: ["nonexistent-1", "nonexistent-2"],
      branch: "main",
    })

    expect(result).toBeNull()
  })
})
