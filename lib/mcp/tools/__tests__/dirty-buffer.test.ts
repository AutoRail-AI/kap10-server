import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { handleSyncDirtyBuffer, resolveEntityWithOverlay } from "../dirty-buffer"
import type { McpAuthContext } from "../../auth"

describe("sync_dirty_buffer", () => {
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
    process.env.DIRTY_OVERLAY_ENABLED = "true"
  })

  // Entity extraction from buffer
  it("extracts entities from TypeScript buffer", async () => {
    const result = await handleSyncDirtyBuffer(
      {
        file_path: "src/foo.ts",
        content: `export function hello() {}\nexport class Foo {}\ninterface Bar {}\nconst baz = () => {}`,
      },
      ctx,
      container
    )
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0]!.text) as { entities_detected: number; entity_names: string[] }
    expect(data.entities_detected).toBeGreaterThan(0)
    expect(data.entity_names).toContain("hello")
    expect(data.entity_names).toContain("Foo")
    expect(data.entity_names).toContain("Bar")
    expect(data.entity_names).toContain("baz")
  })

  it("extracts Python entities when language is python", async () => {
    const result = await handleSyncDirtyBuffer(
      {
        file_path: "src/app.py",
        content: `def process_data():\n    pass\n\nclass DataProcessor:\n    pass\n\nasync def fetch_items():\n    pass`,
        language: "python",
      },
      ctx,
      container
    )
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0]!.text) as { entities_detected: number; entity_names: string[] }
    expect(data.entity_names).toContain("process_data")
    expect(data.entity_names).toContain("DataProcessor")
    expect(data.entity_names).toContain("fetch_items")
  })

  it("extracts Go entities when language is go", async () => {
    const result = await handleSyncDirtyBuffer(
      {
        file_path: "main.go",
        content: `func main() {\n}\n\nfunc (s *Server) HandleRequest() {\n}`,
        language: "go",
      },
      ctx,
      container
    )
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0]!.text) as { entities_detected: number; entity_names: string[] }
    expect(data.entity_names).toContain("main")
    expect(data.entity_names).toContain("HandleRequest")
  })

  // Redis storage with TTL
  it("stores entity data in cache with TTL", async () => {
    await handleSyncDirtyBuffer(
      {
        file_path: "src/cached.ts",
        content: "export function cached() {}",
      },
      ctx,
      container
    )

    // Verify the file-level cache key was set
    const cacheKey = `unerr:dirty:org-1:repo-1:user-1:src/cached.ts`
    const cached = await container.cacheStore.get<{ file_path: string; entities: unknown[] }>(cacheKey)
    expect(cached).not.toBeNull()
    expect(cached!.file_path).toBe("src/cached.ts")
    expect(cached!.entities).toHaveLength(1)
  })

  it("stores per-entity cache keys for fast lookup", async () => {
    await handleSyncDirtyBuffer(
      {
        file_path: "src/multi.ts",
        content: "export function alpha() {}\nexport function beta() {}",
      },
      ctx,
      container
    )

    const alphaKey = `unerr:dirty:entity:org-1:repo-1:alpha`
    const betaKey = `unerr:dirty:entity:org-1:repo-1:beta`

    const alpha = await container.cacheStore.get<{ name: string; dirty: boolean }>(alphaKey)
    const beta = await container.cacheStore.get<{ name: string; dirty: boolean }>(betaKey)

    expect(alpha).not.toBeNull()
    expect(alpha!.name).toBe("alpha")
    expect(alpha!.dirty).toBe(true)

    expect(beta).not.toBeNull()
    expect(beta!.name).toBe("beta")
  })

  // Overlay resolution priority
  it("resolveEntityWithOverlay prefers dirty buffer over committed", async () => {
    // Put an entity in the committed graph store
    await container.graphStore.upsertEntity("org-1", {
      id: "entity-old",
      org_id: "org-1",
      repo_id: "repo-1",
      kind: "function",
      name: "myFunc",
      file_path: "src/test.ts",
    })

    // Sync a dirty buffer with same entity name
    await handleSyncDirtyBuffer(
      {
        file_path: "src/test.ts",
        content: "export function myFunc() { return 'dirty version' }",
      },
      ctx,
      container
    )

    const resolved = await resolveEntityWithOverlay(
      container, "org-1", "repo-1", "myFunc"
    )

    expect(resolved).not.toBeNull()
    expect(resolved!.source).toBe("dirty_buffer")
  })

  it("resolveEntityWithOverlay falls back to committed when no dirty data", async () => {
    await container.graphStore.upsertEntity("org-1", {
      id: "entity-committed",
      org_id: "org-1",
      repo_id: "repo-1",
      kind: "function",
      name: "committedFunc",
      file_path: "src/committed.ts",
    })

    const resolved = await resolveEntityWithOverlay(
      container, "org-1", "repo-1", "committedFunc"
    )

    expect(resolved).not.toBeNull()
    expect(resolved!.source).toBe("committed")
  })

  // Status and error handling
  it("returns disabled status when overlay is off", async () => {
    process.env.DIRTY_OVERLAY_ENABLED = "false"
    const result = await handleSyncDirtyBuffer(
      { file_path: "src/foo.ts", content: "function x() {}" },
      ctx,
      container
    )
    const data = JSON.parse(result.content[0]!.text) as { status: string }
    expect(data.status).toBe("disabled")
  })

  it("requires user context", async () => {
    const noUser = { authMode: "api_key" as const, orgId: "org-1", scopes: ["mcp:sync"] } as McpAuthContext
    const result = await handleSyncDirtyBuffer(
      { file_path: "src/foo.ts", content: "test" },
      noUser,
      container
    )
    expect(result.isError).toBe(true)
  })

  it("requires repository context", async () => {
    const noRepo: McpAuthContext = {
      authMode: "api_key",
      orgId: "org-1",
      userId: "user-1",
      scopes: ["mcp:sync"],
    }
    const result = await handleSyncDirtyBuffer(
      { file_path: "src/foo.ts", content: "test" },
      noRepo,
      container
    )
    expect(result.isError).toBe(true)
  })

  it("returns entity count and names in response", async () => {
    const result = await handleSyncDirtyBuffer(
      {
        file_path: "src/many.ts",
        content: [
          "export function first() {}",
          "export function second() {}",
          "export class Third {}",
        ].join("\n"),
      },
      ctx,
      container
    )

    const data = JSON.parse(result.content[0]!.text) as {
      status: string
      entities_detected: number
      entity_names: string[]
      ttl_seconds: number
    }

    expect(data.status).toBe("synced")
    expect(data.entities_detected).toBe(3)
    expect(data.entity_names).toEqual(expect.arrayContaining(["first", "second", "Third"]))
    expect(data.ttl_seconds).toBeGreaterThan(0)
  })
})
