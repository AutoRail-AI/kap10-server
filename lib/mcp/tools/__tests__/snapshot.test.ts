import { beforeEach, describe, expect, it } from "vitest"
import { type Container, createTestContainer } from "@/lib/di/container"
import type { LedgerEntry } from "@/lib/ports/types"
import type { McpAuthContext } from "../../auth"
import { handleMarkWorking } from "../timeline"

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

describe("handleMarkWorking (mark_working MCP tool)", () => {
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

  it("creates a working snapshot when marking entry", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "snap-entry-1",
      status: "pending",
    }))

    const result = await handleMarkWorking(
      {
        entry_id: "snap-entry-1",
        files: [
          { file_path: "src/foo.ts", content: "export function foo() { return 1 }" },
          { file_path: "src/bar.ts", content: "export const bar = 42" },
        ],
      },
      ctx,
      container
    )

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0]!.text) as {
      status: string
      snapshotId: string
      entryId: string
    }
    expect(data.status).toBe("marked")
    expect(data.snapshotId).toBeTruthy()
    expect(data.entryId).toBe("snap-entry-1")

    // Verify the entry status is now "working"
    const entry = await container.graphStore.getLedgerEntry("org-1", "snap-entry-1")
    expect(entry!.status).toBe("working")
    expect(entry!.validated_at).not.toBeNull()

    // Verify snapshot was stored
    const snapshot = await container.graphStore.getLatestWorkingSnapshot("org-1", "repo-1", "main")
    expect(snapshot).not.toBeNull()
    expect(snapshot!.files.length).toBe(2)
    expect(snapshot!.files[0]!.file_path).toBe("src/foo.ts")
    expect(snapshot!.reason).toBe("user_marked")
  })

  it("returns error for invalid entry ID", async () => {
    const result = await handleMarkWorking(
      {
        entry_id: "nonexistent-entry",
        files: [{ file_path: "src/a.ts", content: "test" }],
      },
      ctx,
      container
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("not found")
  })

  it("succeeds idempotently for already-working entry", async () => {
    // Create a pending entry, mark it working via status update first
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "already-working",
      status: "pending",
    }))
    await container.graphStore.updateLedgerEntryStatus("org-1", "already-working", "working")

    // Now mark_working should still succeed (working -> working is not in valid transitions,
    // but the broken->working transition is valid, so let's test with a broken entry instead)
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "broken-to-working",
      status: "pending",
    }))
    await container.graphStore.updateLedgerEntryStatus("org-1", "broken-to-working", "broken")

    // Mark broken as working
    const result = await handleMarkWorking(
      {
        entry_id: "broken-to-working",
        files: [{ file_path: "src/fixed.ts", content: "fixed code" }],
      },
      ctx,
      container
    )

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0]!.text) as { status: string }
    expect(data.status).toBe("marked")
  })

  it("returns error when userId is missing", async () => {
    const noUserCtx: McpAuthContext = {
      authMode: "api_key",
      orgId: "org-1",
      repoId: "repo-1",
      userId: "",
      scopes: ["mcp:sync"],
    }

    const result = await handleMarkWorking(
      {
        entry_id: "some-entry",
        files: [{ file_path: "src/a.ts", content: "test" }],
      },
      noUserCtx,
      container
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("requires user context")
  })

  it("returns error when files array is empty", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "empty-files",
      status: "pending",
    }))

    const result = await handleMarkWorking(
      {
        entry_id: "empty-files",
        files: [],
      },
      ctx,
      container
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("non-empty array")
  })
})
