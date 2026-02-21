import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { handleMarkWorking } from "../timeline"
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

describe("Full Rewind Cycle E2E", () => {
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

  it("create entries -> mark working -> break -> rewind -> verify restored state", async () => {
    // Step 1: Create an initial ledger entry
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "e2e-1",
      prompt: "Add user service",
      changes: [
        { file_path: "src/services/user.ts", change_type: "added", diff: "+export class UserService {}", lines_added: 20, lines_removed: 0 },
      ],
      status: "pending",
      created_at: new Date(Date.now() - 5000).toISOString(),
    }))

    // Step 2: Mark it as working (via the MCP tool)
    const markResult = await handleMarkWorking(
      {
        entry_id: "e2e-1",
        files: [
          { file_path: "src/services/user.ts", content: "export class UserService { getUser() { return {} } }" },
        ],
      },
      ctx,
      container
    )

    expect(markResult.isError).toBeFalsy()
    const markData = JSON.parse(markResult.content[0]!.text) as { status: string; snapshotId: string }
    expect(markData.status).toBe("marked")

    // Verify entry is now working
    const workingEntry = await container.graphStore.getLedgerEntry("org-1", "e2e-1")
    expect(workingEntry!.status).toBe("working")

    // Verify snapshot was created
    const snapshot = await container.graphStore.getLatestWorkingSnapshot("org-1", "repo-1", "main")
    expect(snapshot).not.toBeNull()
    expect(snapshot!.ledger_entry_id).toBe("e2e-1")

    // Step 3: Add more entries that go bad
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "e2e-2",
      prompt: "Refactor user service to use raw SQL",
      changes: [
        { file_path: "src/services/user.ts", change_type: "modified", diff: "", lines_added: 15, lines_removed: 10 },
        { file_path: "src/db/raw.ts", change_type: "added", diff: "", lines_added: 30, lines_removed: 0 },
      ],
      status: "pending",
      parent_id: "e2e-1",
      created_at: new Date(Date.now() - 3000).toISOString(),
    }))

    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "e2e-3",
      prompt: "Add more raw SQL queries",
      changes: [
        { file_path: "src/db/raw.ts", change_type: "modified", diff: "", lines_added: 25, lines_removed: 5 },
        { file_path: "src/services/repo.ts", change_type: "added", diff: "", lines_added: 40, lines_removed: 0 },
      ],
      status: "broken",
      parent_id: "e2e-2",
      created_at: new Date(Date.now() - 2000).toISOString(),
    }))

    // Step 4: Rewind to the working state
    const rewindResult = await handleRevertToWorking(
      { target_entry_id: "e2e-1" },
      ctx,
      container
    )

    expect(rewindResult.isError).toBeFalsy()
    const rewindData = JSON.parse(rewindResult.content[0]!.text) as {
      status: string
      entriesReverted: number
      timelineBranch: number
      rewindEntryId: string
      blastRadius: {
        safeFiles: string[]
        conflictedFiles: Array<{ filePath: string }>
      }
    }
    expect(rewindData.status).toBe("reverted")
    expect(rewindData.entriesReverted).toBe(2)
    expect(rewindData.timelineBranch).toBe(2) // New timeline branch

    // Step 5: Verify restored state

    // Reverted entries are marked as reverted
    const entry2 = await container.graphStore.getLedgerEntry("org-1", "e2e-2")
    const entry3 = await container.graphStore.getLedgerEntry("org-1", "e2e-3")
    expect(entry2!.status).toBe("reverted")
    expect(entry3!.status).toBe("reverted")

    // Original working entry is still working
    const entry1 = await container.graphStore.getLedgerEntry("org-1", "e2e-1")
    expect(entry1!.status).toBe("working")

    // A new rewind entry was created on the new timeline branch
    const rewindEntry = await container.graphStore.getLedgerEntry("org-1", rewindData.rewindEntryId)
    expect(rewindEntry).not.toBeNull()
    expect(rewindEntry!.timeline_branch).toBe(2)
    expect(rewindEntry!.rewind_target_id).toBe("e2e-1")
    expect(rewindEntry!.status).toBe("working")

    // Blast radius should show conflicted files (user.ts is in both target and e2e-2)
    expect(rewindData.blastRadius.conflictedFiles.some(
      (f) => f.filePath === "src/services/user.ts"
    )).toBe(true)

    // Snapshot from the working state is still available
    const restoredSnapshot = await container.graphStore.getLatestWorkingSnapshot("org-1", "repo-1", "main")
    expect(restoredSnapshot).not.toBeNull()
    expect(restoredSnapshot!.files[0]!.content).toContain("UserService")
  })

  it("handles rewind when there are no entries to revert", async () => {
    // Create a single working entry with no subsequent bad entries
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "sole-entry",
      status: "working",
      validated_at: new Date().toISOString(),
      changes: [],
      created_at: new Date(Date.now() - 1000).toISOString(),
    }))

    const result = await handleRevertToWorking(
      { target_entry_id: "sole-entry" },
      ctx,
      container
    )

    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0]!.text) as {
      status: string
      entriesReverted: number
    }
    expect(data.status).toBe("reverted")
    expect(data.entriesReverted).toBe(0)
  })
})
