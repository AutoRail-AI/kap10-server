import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { handleSyncDirtyBuffer } from "../dirty-buffer"
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
  })

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
})
