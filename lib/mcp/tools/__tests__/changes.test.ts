import { beforeEach, describe, expect, it } from "vitest"
import type { Container } from "@/lib/di/container"
import { InMemoryGraphStore } from "@/lib/di/fakes"
import { handleGetRecentChanges } from "@/lib/mcp/tools/changes"
import type { IndexEventDoc } from "@/lib/ports/types"

describe("handleGetRecentChanges", () => {
  let graphStore: InMemoryGraphStore
  const ctx = { authMode: "api_key" as const, userId: "user-1", orgId: "org-1", repoId: "repo-1", scopes: ["mcp:read"] }

  beforeEach(() => {
    graphStore = new InMemoryGraphStore()
  })

  function makeContainer(): Container {
    return { graphStore } as unknown as Container
  }

  function makeEvent(overrides: Partial<IndexEventDoc> = {}): IndexEventDoc {
    return {
      org_id: "org-1",
      repo_id: "repo-1",
      push_sha: "abc12345",
      commit_message: "test commit",
      event_type: "incremental",
      files_changed: 3,
      entities_added: 2,
      entities_updated: 1,
      entities_deleted: 0,
      edges_repaired: 0,
      embeddings_updated: 2,
      cascade_status: "complete",
      cascade_entities: 5,
      duration_ms: 1234,
      workflow_id: "wf-1",
      created_at: new Date().toISOString(),
      ...overrides,
    }
  }

  it("returns events when they exist", async () => {
    await graphStore.insertIndexEvent("org-1", makeEvent())
    const result = await handleGetRecentChanges({}, ctx, makeContainer())
    expect(result.content[0]?.text).toContain("abc12345")
    expect(result.content[0]?.text).toContain("test commit")
  })

  it("returns empty message when no events", async () => {
    const result = await handleGetRecentChanges({}, ctx, makeContainer())
    expect(result.content[0]?.text).toContain("No recent index events")
  })

  it("respects limit parameter", async () => {
    await graphStore.insertIndexEvent("org-1", makeEvent({ push_sha: "sha1", created_at: "2026-01-01T00:00:00Z" }))
    await graphStore.insertIndexEvent("org-1", makeEvent({ push_sha: "sha2", created_at: "2026-01-02T00:00:00Z" }))
    await graphStore.insertIndexEvent("org-1", makeEvent({ push_sha: "sha3", created_at: "2026-01-03T00:00:00Z" }))

    const result = await handleGetRecentChanges({ limit: 2 }, ctx, makeContainer())
    expect(result.content[0]?.text).toContain("2 events")
  })
})
