import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { simulateShadowRewind } from "../shadow-rewind"

describe("simulateShadowRewind", () => {
  let container: Container

  beforeEach(async () => {
    container = createTestContainer()

    // Create target entry (the known-good state)
    await container.graphStore.appendLedgerEntry("org-1", {
      id: "target",
      org_id: "org-1", repo_id: "repo-1", user_id: "user-1",
      branch: "main", timeline_branch: 1,
      prompt: "Initial good change",
      changes: [{ file_path: "src/a.ts", change_type: "modified", diff: "", lines_added: 5, lines_removed: 0 }],
      status: "working",
      parent_id: null, rewind_target_id: null, commit_sha: null, snapshot_id: null,
      validated_at: new Date().toISOString(), rule_generated: null,
      created_at: new Date(Date.now() - 3000).toISOString(),
    })

    // Create entries after target (to be reverted)
    await container.graphStore.appendLedgerEntry("org-1", {
      id: "bad-1",
      org_id: "org-1", repo_id: "repo-1", user_id: "user-1",
      branch: "main", timeline_branch: 1,
      prompt: "Bad change 1",
      changes: [
        { file_path: "src/b.ts", change_type: "modified", diff: "", lines_added: 3, lines_removed: 1 },
      ],
      status: "broken",
      parent_id: "target", rewind_target_id: null, commit_sha: null, snapshot_id: null,
      validated_at: null, rule_generated: null,
      created_at: new Date(Date.now() - 2000).toISOString(),
    })

    await container.graphStore.appendLedgerEntry("org-1", {
      id: "bad-2",
      org_id: "org-1", repo_id: "repo-1", user_id: "user-1",
      branch: "main", timeline_branch: 1,
      prompt: "Bad change 2",
      changes: [
        { file_path: "src/a.ts", change_type: "modified", diff: "", lines_added: 2, lines_removed: 0 },
        { file_path: "src/c.ts", change_type: "added", diff: "", lines_added: 10, lines_removed: 0 },
      ],
      status: "broken",
      parent_id: "bad-1", rewind_target_id: null, commit_sha: null, snapshot_id: null,
      validated_at: null, rule_generated: null,
      created_at: new Date(Date.now() - 1000).toISOString(),
    })
  })

  it("identifies safe, conflicted, and at-risk files", async () => {
    const result = await simulateShadowRewind(container, "org-1", "repo-1", "main", "target")

    // src/a.ts is in both target and bad-2 → conflicted
    expect(result.conflictedFiles.some(f => f.filePath === "src/a.ts")).toBe(true)

    // src/b.ts is only in bad-1 → safe
    expect(result.safeFiles).toContain("src/b.ts")
  })

  it("throws if target entry not found", async () => {
    await expect(
      simulateShadowRewind(container, "org-1", "repo-1", "main", "nonexistent")
    ).rejects.toThrow("not found")
  })
})
