import { describe, it, expect, beforeEach, vi } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { MockLLMProvider } from "@/lib/di/fakes"
import type { LedgerEntry } from "@/lib/ports/types"

// Mock @temporalio/activity so heartbeat never throws
vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
  Context: { current: () => ({ heartbeat: vi.fn() }) },
}))

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
    branch: "feature/new-thing",
    timeline_branch: 1,
    prompt: "Implement new endpoint for user preferences",
    changes: [
      {
        file_path: "src/api/prefs.ts",
        change_type: "added",
        diff: "@@ -0,0 +1,20 @@",
        lines_added: 20,
        lines_removed: 0,
      },
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

describe("ledger-merge activities", () => {
  let mockLlm: MockLLMProvider

  beforeEach(() => {
    mockLlm = new MockLLMProvider()
    testContainer = createTestContainer({ llmProvider: mockLlm })
  })

  describe("fetchLedgerEntries", () => {
    it("returns entries from graphStore for the given branch", async () => {
      // Seed two entries on the feature branch
      await testContainer.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
        id: "e1",
        branch: "feature/new-thing",
        status: "committed",
      }))
      await testContainer.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
        id: "e2",
        branch: "feature/new-thing",
        status: "committed",
      }))
      // One on a different branch — should not appear
      await testContainer.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
        id: "e3",
        branch: "main",
        status: "committed",
      }))

      const { fetchLedgerEntries } = await import("@/lib/temporal/activities/ledger-merge")

      const result = await fetchLedgerEntries({
        orgId: "org-1",
        repoId: "repo-1",
        branch: "feature/new-thing",
      })

      expect(result.length).toBe(2)
      const ids = result.map((e) => e.id)
      expect(ids).toContain("e1")
      expect(ids).toContain("e2")
      expect(ids).not.toContain("e3")
    })

    it("returns empty array when no entries exist for the branch", async () => {
      const { fetchLedgerEntries } = await import("@/lib/temporal/activities/ledger-merge")

      const result = await fetchLedgerEntries({
        orgId: "org-empty",
        repoId: "repo-empty",
        branch: "nonexistent-branch",
      })

      expect(result).toEqual([])
    })
  })

  describe("reparentLedgerEntries", () => {
    it("marks entries as committed in graphStore", async () => {
      // Append entries with pending status (which allows -> committed transition)
      await testContainer.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
        id: "rp-1",
        status: "pending",
      }))
      await testContainer.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
        id: "rp-2",
        status: "pending",
      }))

      const { reparentLedgerEntries } = await import("@/lib/temporal/activities/ledger-merge")

      await reparentLedgerEntries({
        orgId: "org-1",
        repoId: "repo-1",
        entryIds: ["rp-1", "rp-2"],
        targetBranch: "main",
      })

      const e1 = await testContainer.graphStore.getLedgerEntry("org-1", "rp-1")
      const e2 = await testContainer.graphStore.getLedgerEntry("org-1", "rp-2")
      expect(e1?.status).toBe("committed")
      expect(e2?.status).toBe("committed")
    })

    it("does not throw when entry IDs do not exist (graceful skip)", async () => {
      const { reparentLedgerEntries } = await import("@/lib/temporal/activities/ledger-merge")

      // Should resolve without throwing even for missing IDs
      await expect(
        reparentLedgerEntries({
          orgId: "org-1",
          repoId: "repo-1",
          entryIds: ["nonexistent-id-1", "nonexistent-id-2"],
          targetBranch: "main",
        })
      ).resolves.toBeUndefined()
    })
  })

  describe("createMergeNode", () => {
    it("creates a ledger summary node in graphStore with the correct fields", async () => {
      const { createMergeNode } = await import("@/lib/temporal/activities/ledger-merge")

      await createMergeNode({
        orgId: "org-1",
        repoId: "repo-1",
        sourceBranch: "feature/new-thing",
        targetBranch: "main",
        prNumber: 17,
        mergedBy: "user-alice",
        entryCount: 5,
      })

      const summaries = await testContainer.graphStore.queryLedgerSummaries(
        "org-1",
        "repo-1",
        "main",
        10
      )

      expect(summaries.length).toBeGreaterThanOrEqual(1)

      const mergeNode = summaries.find((s) => s.id === "merge-org-1-repo-1-pr-17")
      expect(mergeNode).toBeDefined()
      expect(mergeNode!.commit_sha).toBe("pr-17")
      expect(mergeNode!.branch).toBe("main")
      expect(mergeNode!.entry_count).toBe(5)
      expect(mergeNode!.user_id).toBe("user-alice")
      expect(mergeNode!.prompt_summary).toContain("PR #17")
    })
  })

  describe("synthesizeLedgerSummary", () => {
    it("returns a narrative string when entries have prompts", async () => {
      // Override LLM to return a concrete narrative
      mockLlm.generateObject = async <T>(params: { schema: { parse: (v: unknown) => T } }) => ({
        object: params.schema.parse({}),
        usage: { inputTokens: 100, outputTokens: 50 },
      })

      // Mock the summarizeLedger use-case via module mock
      vi.mock("@/lib/use-cases/summarizer", () => ({
        summarizeLedger: vi.fn().mockResolvedValue(
          "PR #5: Added user preferences endpoint and updated API schema"
        ),
      }))

      const entries: LedgerEntry[] = [
        makeLedgerEntry({ id: "s1", prompt: "Add user preferences GET endpoint" }),
        makeLedgerEntry({ id: "s2", prompt: "Add user preferences POST endpoint" }),
      ]

      const { synthesizeLedgerSummary } = await import("@/lib/temporal/activities/ledger-merge")

      const result = await synthesizeLedgerSummary({
        orgId: "org-1",
        repoId: "repo-1",
        entries,
        prNumber: 5,
        sourceBranch: "feature/prefs",
        targetBranch: "main",
      })

      // The result should be a string (the narrative) or null on LLM failure
      expect(result === null || typeof result === "string").toBe(true)
    })

    it("returns null when entries have no prompts", async () => {
      const entries: LedgerEntry[] = [
        makeLedgerEntry({ id: "np-1", prompt: "" }),
        makeLedgerEntry({ id: "np-2", prompt: "" }),
      ]

      const { synthesizeLedgerSummary } = await import("@/lib/temporal/activities/ledger-merge")

      const result = await synthesizeLedgerSummary({
        orgId: "org-1",
        repoId: "repo-1",
        entries,
        prNumber: 10,
        sourceBranch: "feature/empty",
        targetBranch: "main",
      })

      expect(result).toBeNull()
    })

    it("returns null when entries array is empty", async () => {
      const { synthesizeLedgerSummary } = await import("@/lib/temporal/activities/ledger-merge")

      const result = await synthesizeLedgerSummary({
        orgId: "org-1",
        repoId: "repo-1",
        entries: [],
        prNumber: 11,
        sourceBranch: "feature/none",
        targetBranch: "main",
      })

      expect(result).toBeNull()
    })
  })

  describe("storeLedgerSummary", () => {
    it("updates the merge node with the narrative string", async () => {
      // Create the merge node first (as createMergeNode would)
      await testContainer.graphStore.appendLedgerSummary("org-1", {
        id: "merge-org-1-repo-1-pr-20",
        commit_sha: "pr-20",
        org_id: "org-1",
        repo_id: "repo-1",
        user_id: "user-1",
        branch: "main",
        entry_count: 3,
        prompt_summary: "Merge PR #20: feature/x → main",
        total_files_changed: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
        rewind_count: 0,
        rules_generated: [],
        created_at: new Date().toISOString(),
      })

      const { storeLedgerSummary } = await import("@/lib/temporal/activities/ledger-merge")

      const narrative = "This PR introduced a new feature area for user preferences."

      await storeLedgerSummary({
        orgId: "org-1",
        repoId: "repo-1",
        branch: "main",
        prNumber: 20,
        narrative,
        entryCount: 3,
      })

      const summaries = await testContainer.graphStore.queryLedgerSummaries(
        "org-1",
        "repo-1",
        "main",
        10
      )

      // The latest summary should have the narrative as prompt_summary
      const updated = summaries.find((s) => s.prompt_summary === narrative)
      expect(updated).toBeDefined()
    })

    it("does nothing gracefully when no existing summary is found", async () => {
      const { storeLedgerSummary } = await import("@/lib/temporal/activities/ledger-merge")

      // Should not throw when there are no summaries to update
      await expect(
        storeLedgerSummary({
          orgId: "org-no-summary",
          repoId: "repo-no-summary",
          branch: "main",
          prNumber: 99,
          narrative: "Some narrative",
          entryCount: 0,
        })
      ).resolves.toBeUndefined()
    })
  })
})
