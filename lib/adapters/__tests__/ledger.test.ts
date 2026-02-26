import { beforeEach, describe, expect, it } from "vitest"
import { type Container, createTestContainer } from "@/lib/di/container"
import type { LedgerEntry } from "@/lib/ports/types"

function makeLedgerEntry(overrides?: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    org_id: "org-1",
    repo_id: "repo-1",
    user_id: "user-1",
    branch: "main",
    timeline_branch: 1,
    prompt: "Test prompt",
    changes: [{ file_path: "src/foo.ts", change_type: "modified", diff: "@@ -1,3 +1,4 @@", lines_added: 1, lines_removed: 0 }],
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

describe("Ledger CRUD + State Machine", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
  })

  it("appends and retrieves a ledger entry", async () => {
    const entry = makeLedgerEntry({ id: "entry-1" })
    await container.graphStore.appendLedgerEntry("org-1", entry)
    const retrieved = await container.graphStore.getLedgerEntry("org-1", "entry-1")
    expect(retrieved).not.toBeNull()
    expect(retrieved!.prompt).toBe("Test prompt")
  })

  it("updates entry status following valid transitions", async () => {
    const entry = makeLedgerEntry({ id: "entry-2" })
    await container.graphStore.appendLedgerEntry("org-1", entry)

    await container.graphStore.updateLedgerEntryStatus("org-1", "entry-2", "working")
    const updated = await container.graphStore.getLedgerEntry("org-1", "entry-2")
    expect(updated!.status).toBe("working")
    expect(updated!.validated_at).not.toBeNull()
  })

  it("rejects invalid state transitions", async () => {
    const entry = makeLedgerEntry({ id: "entry-3", status: "committed" })
    await container.graphStore.appendLedgerEntry("org-1", entry)

    await expect(
      container.graphStore.updateLedgerEntryStatus("org-1", "entry-3", "working")
    ).rejects.toThrow("Invalid ledger transition")
  })

  it("queries timeline with cursor pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
        id: `page-${i}`,
        created_at: new Date(Date.now() + i * 1000).toISOString(),
      }))
    }

    const page1 = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1", repoId: "repo-1", limit: 2,
    })
    expect(page1.items.length).toBe(2)
    expect(page1.hasMore).toBe(true)

    const page2 = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1", repoId: "repo-1", limit: 2, cursor: page1.cursor!,
    })
    expect(page2.items.length).toBe(2)
  })

  it("gets uncommitted entries", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({ id: "u-1", status: "pending" }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({ id: "u-2", status: "working" }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({ id: "u-3", status: "committed" }))

    const uncommitted = await container.graphStore.getUncommittedEntries("org-1", "repo-1", "main")
    expect(uncommitted.length).toBe(2)
  })

  it("marks entries as reverted atomically", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({ id: "r-1" }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({ id: "r-2" }))

    await container.graphStore.markEntriesReverted("org-1", ["r-1", "r-2"])

    const e1 = await container.graphStore.getLedgerEntry("org-1", "r-1")
    const e2 = await container.graphStore.getLedgerEntry("org-1", "r-2")
    expect(e1!.status).toBe("reverted")
    expect(e2!.status).toBe("reverted")
  })

  it("gets max timeline branch", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({ id: "tb-1", timeline_branch: 1 }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({ id: "tb-2", timeline_branch: 3 }))

    const max = await container.graphStore.getMaxTimelineBranch("org-1", "repo-1", "main")
    expect(max).toBe(3)
  })

  it("appends and queries ledger summaries", async () => {
    await container.graphStore.appendLedgerSummary("org-1", {
      id: "sum-1",
      commit_sha: "abc123",
      org_id: "org-1",
      repo_id: "repo-1",
      user_id: "user-1",
      branch: "main",
      entry_count: 5,
      prompt_summary: "Multiple changes",
      total_files_changed: 3,
      total_lines_added: 50,
      total_lines_removed: 10,
      rewind_count: 1,
      rules_generated: ["rule-1"],
      created_at: new Date().toISOString(),
    })

    const summaries = await container.graphStore.queryLedgerSummaries("org-1", "repo-1")
    expect(summaries.length).toBe(1)
    expect(summaries[0]!.commit_sha).toBe("abc123")
  })

  it("appends and retrieves working snapshots", async () => {
    await container.graphStore.appendWorkingSnapshot("org-1", {
      id: "snap-1",
      org_id: "org-1",
      repo_id: "repo-1",
      user_id: "user-1",
      branch: "main",
      timeline_branch: 1,
      ledger_entry_id: "entry-1",
      reason: "tests_passed",
      files: [{ file_path: "src/foo.ts", content: "// test", entity_hashes: [] }],
      created_at: new Date().toISOString(),
    })

    const snap = await container.graphStore.getLatestWorkingSnapshot("org-1", "repo-1", "main")
    expect(snap).not.toBeNull()
    expect(snap!.reason).toBe("tests_passed")
  })
})
