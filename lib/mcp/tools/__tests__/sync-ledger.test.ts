import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { handleSyncLocalDiff } from "../sync"
import type { McpAuthContext } from "../../auth"

describe("sync_local_diff with ledger", () => {
  let container: Container
  const ctx: McpAuthContext = {
    authMode: "api_key",
    orgId: "org-1",
    repoId: "repo-1",
    userId: "user-1",
    scopes: ["mcp:sync"],
  }

  beforeEach(() => {
    container = createTestContainer()
  })

  it("still syncs without prompt (backward compat)", async () => {
    const result = await handleSyncLocalDiff(
      { diff: "diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,4 @@\n+// new line\n old line" },
      ctx,
      container
    )
    expect(result.isError).toBeFalsy()
    const text = result.content[0]!.text
    const data = JSON.parse(text) as Record<string, unknown>
    expect(data.status).toBe("synced")
    // No ledger entry without prompt
    expect(data.ledgerEntryId).toBeUndefined()
  })

  it("appends ledger entry when prompt is provided", async () => {
    const result = await handleSyncLocalDiff(
      {
        diff: "diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,4 @@\n+// new line\n old line",
        prompt: "Add a comment",
        agent_model: "gpt-4o",
        agent_tool: "cursor",
      },
      ctx,
      container
    )
    expect(result.isError).toBeFalsy()
    const text = result.content[0]!.text
    const data = JSON.parse(text) as Record<string, unknown>
    expect(data.status).toBe("synced")
    expect(data.ledgerEntryId).toBeDefined()
    expect(data.timelineBranch).toBeDefined()
  })

  it("auto-creates working snapshot when validation passes", async () => {
    const result = await handleSyncLocalDiff(
      {
        diff: "diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,4 @@\n+// new\n old",
        prompt: "Fix bug",
        validation_result: { tests_pass: true, lint_pass: true },
      },
      ctx,
      container
    )
    const text = result.content[0]!.text
    const data = JSON.parse(text) as Record<string, unknown>
    expect(data.ledgerEntryId).toBeDefined()

    // Check working snapshot was created
    const snap = await container.graphStore.getLatestWorkingSnapshot("org-1", "repo-1", "main")
    expect(snap).not.toBeNull()
    expect(snap!.reason).toBe("tests_passed")
  })
})
