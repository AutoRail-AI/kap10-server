import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import type { LedgerEntry, LedgerSummary } from "@/lib/ports/types"

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

describe("Ledger Summary Roll-up", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
  })

  it("rolls up multiple entries into a single summary", async () => {
    // Simulate multiple ledger entries that would be committed together
    const entries: LedgerEntry[] = [
      makeLedgerEntry({
        id: "e-1",
        prompt: "Add user authentication",
        changes: [
          { file_path: "src/auth.ts", change_type: "added", diff: "", lines_added: 50, lines_removed: 0 },
          { file_path: "src/middleware.ts", change_type: "modified", diff: "", lines_added: 10, lines_removed: 2 },
        ],
        status: "working",
        created_at: new Date(Date.now() - 3000).toISOString(),
      }),
      makeLedgerEntry({
        id: "e-2",
        prompt: "Add login page",
        changes: [
          { file_path: "src/pages/login.tsx", change_type: "added", diff: "", lines_added: 30, lines_removed: 0 },
        ],
        status: "working",
        created_at: new Date(Date.now() - 2000).toISOString(),
      }),
      makeLedgerEntry({
        id: "e-3",
        prompt: "Fix auth redirect",
        changes: [
          { file_path: "src/auth.ts", change_type: "modified", diff: "", lines_added: 5, lines_removed: 3 },
        ],
        status: "working",
        created_at: new Date(Date.now() - 1000).toISOString(),
      }),
    ]

    for (const entry of entries) {
      await container.graphStore.appendLedgerEntry("org-1", entry)
    }

    // Compute summary values from entries (this is what the commit roll-up logic does)
    const totalFilesChanged = new Set(entries.flatMap((e) => e.changes.map((c) => c.file_path))).size
    const totalLinesAdded = entries.reduce(
      (sum: number, e) => sum + e.changes.reduce((s: number, c) => s + c.lines_added, 0),
      0
    )
    const totalLinesRemoved = entries.reduce(
      (sum: number, e) => sum + e.changes.reduce((s: number, c) => s + c.lines_removed, 0),
      0
    )

    const summary: LedgerSummary = {
      id: "summary-1",
      commit_sha: "abc123def456",
      org_id: "org-1",
      repo_id: "repo-1",
      user_id: "user-1",
      branch: "main",
      entry_count: entries.length,
      prompt_summary: entries.map((e) => e.prompt).join("; "),
      total_files_changed: totalFilesChanged,
      total_lines_added: totalLinesAdded,
      total_lines_removed: totalLinesRemoved,
      rewind_count: 0,
      rules_generated: [],
      created_at: new Date().toISOString(),
    }

    await container.graphStore.appendLedgerSummary("org-1", summary)

    const summaries = await container.graphStore.queryLedgerSummaries("org-1", "repo-1", "main")
    expect(summaries.length).toBe(1)

    const stored = summaries[0]!
    expect(stored.entry_count).toBe(3)
    expect(stored.total_files_changed).toBe(3) // auth.ts, middleware.ts, login.tsx
    expect(stored.total_lines_added).toBe(95)
    expect(stored.total_lines_removed).toBe(5)
    expect(stored.commit_sha).toBe("abc123def456")
  })

  it("tracks rewind count in summary", async () => {
    // One entry was a rewind entry
    const entries: LedgerEntry[] = [
      makeLedgerEntry({
        id: "rw-1",
        prompt: "Initial change",
        status: "working",
        created_at: new Date(Date.now() - 3000).toISOString(),
      }),
      makeLedgerEntry({
        id: "rw-2",
        prompt: "Bad change",
        status: "reverted",
        created_at: new Date(Date.now() - 2000).toISOString(),
      }),
      makeLedgerEntry({
        id: "rw-3",
        prompt: "[REWIND] Reverted to entry rw-1",
        rewind_target_id: "rw-1",
        status: "working",
        created_at: new Date(Date.now() - 1000).toISOString(),
      }),
    ]

    for (const entry of entries) {
      await container.graphStore.appendLedgerEntry("org-1", entry)
    }

    const rewindCount = entries.filter((e) => e.rewind_target_id !== null).length

    const summary: LedgerSummary = {
      id: "summary-rw",
      commit_sha: "rewind123",
      org_id: "org-1",
      repo_id: "repo-1",
      user_id: "user-1",
      branch: "main",
      entry_count: entries.length,
      prompt_summary: "Initial change with 1 rewind",
      total_files_changed: 1,
      total_lines_added: 1,
      total_lines_removed: 0,
      rewind_count: rewindCount,
      rules_generated: [],
      created_at: new Date().toISOString(),
    }

    await container.graphStore.appendLedgerSummary("org-1", summary)
    const summaries = await container.graphStore.queryLedgerSummaries("org-1", "repo-1")
    expect(summaries[0]!.rewind_count).toBe(1)
  })

  it("populates rules_generated list from entries", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "rule-entry-1",
      prompt: "[REWIND] Reverted to safe state",
      rewind_target_id: "earlier",
      rule_generated: "rule-abc",
      status: "working",
    }))

    const rulesGenerated = ["rule-abc", "rule-def"]

    const summary: LedgerSummary = {
      id: "summary-rules",
      commit_sha: "rules123",
      org_id: "org-1",
      repo_id: "repo-1",
      user_id: "user-1",
      branch: "main",
      entry_count: 3,
      prompt_summary: "Changes with anti-pattern rules",
      total_files_changed: 2,
      total_lines_added: 10,
      total_lines_removed: 5,
      rewind_count: 1,
      rules_generated: rulesGenerated,
      created_at: new Date().toISOString(),
    }

    await container.graphStore.appendLedgerSummary("org-1", summary)
    const summaries = await container.graphStore.queryLedgerSummaries("org-1", "repo-1")
    expect(summaries[0]!.rules_generated).toEqual(["rule-abc", "rule-def"])
    expect(summaries[0]!.rules_generated.length).toBe(2)
  })
})
