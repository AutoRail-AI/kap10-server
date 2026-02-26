import { beforeEach, describe, expect, it } from "vitest"
import { type Container, createTestContainer } from "@/lib/di/container"
import type { LedgerEntry } from "@/lib/ports/types"
import { simulateShadowRewind } from "../shadow-rewind"

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
      { file_path: "src/foo.ts", change_type: "modified", diff: "", lines_added: 1, lines_removed: 0 },
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

describe("simulateShadowRewind", () => {
  let container: Container

  beforeEach(async () => {
    container = createTestContainer()
  })

  it("identifies safe files correctly", async () => {
    // Target entry touches src/a.ts
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "target",
      status: "working",
      validated_at: new Date().toISOString(),
      changes: [
        { file_path: "src/a.ts", change_type: "modified", diff: "", lines_added: 5, lines_removed: 0 },
      ],
      created_at: new Date(Date.now() - 3000).toISOString(),
    }))

    // Bad entry only touches src/b.ts (different from target)
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "bad-1",
      status: "broken",
      parent_id: "target",
      changes: [
        { file_path: "src/b.ts", change_type: "modified", diff: "", lines_added: 3, lines_removed: 1 },
      ],
      created_at: new Date(Date.now() - 2000).toISOString(),
    }))

    const result = await simulateShadowRewind(container, "org-1", "repo-1", "main", "target")

    // src/b.ts is only in bad-1, not in target -> safe
    expect(result.safeFiles).toContain("src/b.ts")
    expect(result.conflictedFiles.length).toBe(0)
  })

  it("detects conflicted files when target entry touches same files", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "target-conflict",
      status: "working",
      validated_at: new Date().toISOString(),
      changes: [
        { file_path: "src/shared.ts", change_type: "modified", diff: "", lines_added: 10, lines_removed: 2 },
      ],
      created_at: new Date(Date.now() - 3000).toISOString(),
    }))

    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "bad-conflict",
      status: "broken",
      parent_id: "target-conflict",
      changes: [
        { file_path: "src/shared.ts", change_type: "modified", diff: "", lines_added: 5, lines_removed: 3 },
      ],
      created_at: new Date(Date.now() - 2000).toISOString(),
    }))

    const result = await simulateShadowRewind(container, "org-1", "repo-1", "main", "target-conflict")

    expect(result.conflictedFiles.length).toBe(1)
    expect(result.conflictedFiles[0]!.filePath).toBe("src/shared.ts")
  })

  it("detects manual changes at risk when multiple entries touch same file", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "target-manual",
      status: "working",
      validated_at: new Date().toISOString(),
      changes: [
        { file_path: "src/safe.ts", change_type: "modified", diff: "", lines_added: 1, lines_removed: 0 },
      ],
      created_at: new Date(Date.now() - 4000).toISOString(),
    }))

    // Two bad entries both touch src/risky.ts (which target does NOT touch)
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "bad-manual-1",
      status: "broken",
      parent_id: "target-manual",
      changes: [
        { file_path: "src/risky.ts", change_type: "modified", diff: "", lines_added: 5, lines_removed: 0 },
      ],
      created_at: new Date(Date.now() - 3000).toISOString(),
    }))

    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "bad-manual-2",
      status: "broken",
      parent_id: "bad-manual-1",
      changes: [
        { file_path: "src/risky.ts", change_type: "modified", diff: "", lines_added: 3, lines_removed: 2 },
      ],
      created_at: new Date(Date.now() - 2000).toISOString(),
    }))

    const result = await simulateShadowRewind(container, "org-1", "repo-1", "main", "target-manual")

    // src/risky.ts is not in target but is in 2 entries -> manualChangesAtRisk
    expect(result.manualChangesAtRisk.length).toBe(1)
    expect(result.manualChangesAtRisk[0]!.filePath).toBe("src/risky.ts")
    expect(result.safeFiles.length).toBe(0)
    expect(result.conflictedFiles.length).toBe(0)
  })

  it("returns empty result when no entries to revert", async () => {
    // Only the target exists, nothing after it
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "alone",
      status: "working",
      validated_at: new Date().toISOString(),
      changes: [
        { file_path: "src/ok.ts", change_type: "modified", diff: "", lines_added: 1, lines_removed: 0 },
      ],
      created_at: new Date(Date.now() - 1000).toISOString(),
    }))

    const result = await simulateShadowRewind(container, "org-1", "repo-1", "main", "alone")

    expect(result.safeFiles.length).toBe(0)
    expect(result.conflictedFiles.length).toBe(0)
    expect(result.manualChangesAtRisk.length).toBe(0)
  })

  it("throws if target entry not found", async () => {
    await expect(
      simulateShadowRewind(container, "org-1", "repo-1", "main", "nonexistent")
    ).rejects.toThrow("not found")
  })

  it("only considers uncommitted entries after target for revert", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "committed-before",
      status: "committed",
      changes: [
        { file_path: "src/old.ts", change_type: "modified", diff: "", lines_added: 1, lines_removed: 0 },
      ],
      created_at: new Date(Date.now() - 5000).toISOString(),
    }))

    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "target-after-committed",
      status: "working",
      validated_at: new Date().toISOString(),
      changes: [],
      created_at: new Date(Date.now() - 4000).toISOString(),
    }))

    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "bad-after",
      status: "broken",
      parent_id: "target-after-committed",
      changes: [
        { file_path: "src/new-bad.ts", change_type: "added", diff: "", lines_added: 10, lines_removed: 0 },
      ],
      created_at: new Date(Date.now() - 3000).toISOString(),
    }))

    const result = await simulateShadowRewind(
      container, "org-1", "repo-1", "main", "target-after-committed"
    )

    // Only bad-after should be considered, not committed-before
    expect(result.safeFiles).toContain("src/new-bad.ts")
    expect(result.safeFiles.length).toBe(1)
  })
})
