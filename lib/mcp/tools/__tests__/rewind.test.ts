import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { handleRevertToWorking } from "../rewind"
import type { McpAuthContext } from "../../auth"
import type { LedgerEntry } from "@/lib/ports/types"

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

describe("handleRevertToWorking (revert_to_working_state MCP tool)", () => {
  let container: Container
  const ctx: McpAuthContext = {
    authMode: "oauth",
    orgId: "org-1",
    repoId: "repo-1",
    userId: "user-1",
    scopes: ["mcp:read", "mcp:sync"],
  }

  beforeEach(() => {
    container = createTestContainer()
  })

  it("marks intermediate entries as reverted on rewind", async () => {
    // Target entry (known-good)
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "target-1",
      status: "working",
      validated_at: new Date().toISOString(),
      changes: [{ file_path: "src/a.ts", change_type: "modified", diff: "", lines_added: 1, lines_removed: 0 }],
      created_at: new Date(Date.now() - 3000).toISOString(),
    }))

    // Bad entry after target
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "bad-1",
      status: "broken",
      parent_id: "target-1",
      changes: [{ file_path: "src/b.ts", change_type: "modified", diff: "", lines_added: 2, lines_removed: 0 }],
      created_at: new Date(Date.now() - 2000).toISOString(),
    }))

    // Another bad entry
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "bad-2",
      status: "broken",
      parent_id: "bad-1",
      changes: [{ file_path: "src/c.ts", change_type: "added", diff: "", lines_added: 5, lines_removed: 0 }],
      created_at: new Date(Date.now() - 1000).toISOString(),
    }))

    const result = await handleRevertToWorking(
      { target_entry_id: "target-1" },
      ctx,
      container
    )

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0]!.text) as {
      status: string
      entriesReverted: number
    }
    expect(data.status).toBe("reverted")
    expect(data.entriesReverted).toBe(2)

    // Verify intermediate entries are marked reverted
    const bad1 = await container.graphStore.getLedgerEntry("org-1", "bad-1")
    const bad2 = await container.graphStore.getLedgerEntry("org-1", "bad-2")
    expect(bad1!.status).toBe("reverted")
    expect(bad2!.status).toBe("reverted")
  })

  it("increments timeline branch on rewind", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "target-2",
      status: "working",
      validated_at: new Date().toISOString(),
      timeline_branch: 1,
      changes: [],
      created_at: new Date(Date.now() - 2000).toISOString(),
    }))

    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "bad-after-2",
      status: "broken",
      timeline_branch: 1,
      parent_id: "target-2",
      created_at: new Date(Date.now() - 1000).toISOString(),
    }))

    const result = await handleRevertToWorking(
      { target_entry_id: "target-2" },
      ctx,
      container
    )

    const data = JSON.parse(result.content[0]!.text) as { timelineBranch: number }
    expect(data.timelineBranch).toBe(2)
  })

  it("dry run returns blast radius without making changes", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "target-dry",
      status: "working",
      validated_at: new Date().toISOString(),
      changes: [{ file_path: "src/shared.ts", change_type: "modified", diff: "", lines_added: 1, lines_removed: 0 }],
      created_at: new Date(Date.now() - 2000).toISOString(),
    }))

    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "bad-dry",
      status: "broken",
      parent_id: "target-dry",
      changes: [{ file_path: "src/other.ts", change_type: "modified", diff: "", lines_added: 3, lines_removed: 1 }],
      created_at: new Date(Date.now() - 1000).toISOString(),
    }))

    const result = await handleRevertToWorking(
      { target_entry_id: "target-dry", dry_run: true },
      ctx,
      container
    )

    const data = JSON.parse(result.content[0]!.text) as { status: string }
    expect(data.status).toBe("dry_run")

    // Verify no changes were made
    const badEntry = await container.graphStore.getLedgerEntry("org-1", "bad-dry")
    expect(badEntry!.status).toBe("broken")
  })

  it("returns error for missing entry", async () => {
    const result = await handleRevertToWorking(
      { target_entry_id: "nonexistent" },
      ctx,
      container
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("not found")
  })

  it("returns error when entry belongs to different repo", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "wrong-repo",
      repo_id: "other-repo",
      status: "working",
      validated_at: new Date().toISOString(),
    }))

    const result = await handleRevertToWorking(
      { target_entry_id: "wrong-repo" },
      ctx,
      container
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("does not belong")
  })
})
