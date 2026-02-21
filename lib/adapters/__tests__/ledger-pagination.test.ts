import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
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

describe("Ledger Timeline Pagination", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
  })

  it("first page returns correct items", async () => {
    // Insert 10 entries with sequential timestamps
    for (let i = 0; i < 10; i++) {
      await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
        id: `pag-${i}`,
        prompt: `Entry ${i}`,
        created_at: new Date(Date.now() + i * 1000).toISOString(),
      }))
    }

    const page = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1",
      repoId: "repo-1",
      limit: 3,
    })

    expect(page.items.length).toBe(3)
    expect(page.hasMore).toBe(true)
    expect(page.cursor).not.toBeNull()
    // Newest first
    expect(page.items[0]!.id).toBe("pag-9")
    expect(page.items[1]!.id).toBe("pag-8")
    expect(page.items[2]!.id).toBe("pag-7")
  })

  it("cursor-based pagination returns all entries across pages", async () => {
    for (let i = 0; i < 7; i++) {
      await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
        id: `cur-${i}`,
        prompt: `Entry ${i}`,
        created_at: new Date(Date.now() + i * 1000).toISOString(),
      }))
    }

    // Page 1
    const page1 = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1",
      repoId: "repo-1",
      limit: 3,
    })
    expect(page1.items.length).toBe(3)
    expect(page1.hasMore).toBe(true)

    // Page 2
    const page2 = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1",
      repoId: "repo-1",
      limit: 3,
      cursor: page1.cursor!,
    })
    expect(page2.items.length).toBe(3)
    expect(page2.hasMore).toBe(true)

    // Page 3 (last)
    const page3 = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1",
      repoId: "repo-1",
      limit: 3,
      cursor: page2.cursor!,
    })
    expect(page3.items.length).toBe(1)
    expect(page3.hasMore).toBe(false)

    // Verify no duplicates across pages
    const allIds = [
      ...page1.items.map((e) => e.id),
      ...page2.items.map((e) => e.id),
      ...page3.items.map((e) => e.id),
    ]
    expect(new Set(allIds).size).toBe(7)
  })

  it("filters by branch", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "br-main",
      branch: "main",
    }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "br-feat",
      branch: "feature/new",
    }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "br-main-2",
      branch: "main",
    }))

    const result = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1",
      repoId: "repo-1",
      branch: "feature/new",
    })

    expect(result.items.length).toBe(1)
    expect(result.items[0]!.id).toBe("br-feat")
  })

  it("filters by status", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "st-pending",
      status: "pending",
    }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "st-working",
      status: "working",
    }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "st-broken",
      status: "broken",
    }))

    const workingOnly = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1",
      repoId: "repo-1",
      status: "working",
    })

    expect(workingOnly.items.length).toBe(1)
    expect(workingOnly.items[0]!.id).toBe("st-working")
  })

  it("filters by userId", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "u-alice",
      user_id: "alice",
    }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "u-bob",
      user_id: "bob",
    }))

    const result = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1",
      repoId: "repo-1",
      userId: "alice",
    })

    expect(result.items.length).toBe(1)
    expect(result.items[0]!.id).toBe("u-alice")
  })

  it("filters by timeline branch", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "tb-1",
      timeline_branch: 1,
    }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "tb-2",
      timeline_branch: 2,
    }))
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "tb-1b",
      timeline_branch: 1,
    }))

    const result = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1",
      repoId: "repo-1",
      timelineBranch: 2,
    })

    expect(result.items.length).toBe(1)
    expect(result.items[0]!.id).toBe("tb-2")
  })

  it("returns empty result when no entries match", async () => {
    const result = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1",
      repoId: "repo-1",
    })

    expect(result.items.length).toBe(0)
    expect(result.hasMore).toBe(false)
    expect(result.cursor).toBeNull()
  })

  it("returns empty when branch filter matches nothing", async () => {
    await container.graphStore.appendLedgerEntry("org-1", makeLedgerEntry({
      id: "empty-branch",
      branch: "main",
    }))

    const result = await container.graphStore.queryLedgerTimeline({
      orgId: "org-1",
      repoId: "repo-1",
      branch: "nonexistent-branch",
    })

    expect(result.items.length).toBe(0)
    expect(result.hasMore).toBe(false)
  })
})
