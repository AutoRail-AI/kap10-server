import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Container } from "@/lib/di/container"

vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
}))

vi.mock("@/lib/di/container", async () => {
  const actual = await vi.importActual("@/lib/di/container") as Record<string, unknown>
  let testContainer: Container | null = null
  return {
    ...actual,
    getContainer: () => testContainer ?? (actual.createTestContainer as () => Container)(),
    __setTestContainer: (c: Container) => { testContainer = c },
    __resetTestContainer: () => { testContainer = null },
  }
})

const { createTestContainer } = await import("@/lib/di/container") as typeof import("@/lib/di/container") & {
  __setTestContainer: (c: Container) => void
  __resetTestContainer: () => void
}
const { __setTestContainer, __resetTestContainer } = await import("@/lib/di/container") as typeof import("@/lib/di/container") & {
  __setTestContainer: (c: Container) => void
  __resetTestContainer: () => void
}

const { queryCompactGraph, serializeToMsgpack } = await import("../graph-export")

describe("graph-export activities", () => {
  let container: Container

  beforeEach(async () => {
    container = createTestContainer()
    __setTestContainer(container)

    // Seed some entities via the fake graph store
    await container.graphStore.bulkUpsertEntities("org1", [
      { id: "fn1", org_id: "org1", repo_id: "repo1", kind: "function", name: "doStuff", file_path: "src/index.ts", start_line: 10 },
      { id: "fn2", org_id: "org1", repo_id: "repo1", kind: "function", name: "helper", file_path: "src/index.ts", start_line: 20 },
    ])
  })

  afterEach(() => {
    __resetTestContainer()
  })

  describe("queryCompactGraph", () => {
    it("returns compact entities", async () => {
      const result = await queryCompactGraph({ orgId: "org1", repoId: "repo1" })
      expect(result.entities.length).toBeGreaterThan(0)
      // Each entity should have key, kind, name, file_path
      for (const entity of result.entities) {
        expect(entity).toHaveProperty("key")
        expect(entity).toHaveProperty("kind")
        expect(entity).toHaveProperty("name")
        expect(entity).toHaveProperty("file_path")
        // Should NOT have org_id or repo_id
        expect(entity).not.toHaveProperty("org_id")
        expect(entity).not.toHaveProperty("repo_id")
      }
    })

    it("returns edges array", async () => {
      const result = await queryCompactGraph({ orgId: "org1", repoId: "repo1" })
      expect(Array.isArray(result.edges)).toBe(true)
    })
  })

  describe("serializeToMsgpack", () => {
    it("serializes entities and edges to buffer with checksum", async () => {
      const result = await serializeToMsgpack({
        repoId: "repo1",
        orgId: "org1",
        entities: [
          { key: "fn1", kind: "function", name: "doStuff", file_path: "src/index.ts" },
        ],
        edges: [
          { from_key: "fn1", to_key: "fn2", type: "calls" },
        ],
      })

      expect(Buffer.isBuffer(result.buffer)).toBe(true)
      expect(result.buffer.length).toBeGreaterThan(0)
      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/)
      expect(result.entityCount).toBe(1)
      expect(result.edgeCount).toBe(1)
    })
  })
})
