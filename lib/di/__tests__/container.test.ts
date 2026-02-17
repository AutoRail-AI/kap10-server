/**
 * DI Container Factory Tests
 *
 * Verifies createTestContainer returns all 11 keys and supports overrides.
 */
import { describe, expect, it } from "vitest"

import { createTestContainer } from "@/lib/di/container"

const CONTAINER_KEYS = [
  "graphStore",
  "relationalStore",
  "llmProvider",
  "workflowEngine",
  "gitHost",
  "vectorSearch",
  "billingProvider",
  "observability",
  "cacheStore",
  "codeIntelligence",
  "patternEngine",
] as const

describe("createTestContainer", () => {
  it("returns all 11 container keys", () => {
    const container = createTestContainer()
    for (const key of CONTAINER_KEYS) {
      expect(container[key]).toBeDefined()
    }
  })

  it("returns 11 distinct values (no shared instances between keys)", () => {
    const container = createTestContainer()
    const values = CONTAINER_KEYS.map((k) => container[k])
    const unique = new Set(values)
    expect(unique.size).toBe(11)
  })

  it("supports overrides for individual keys", () => {
    const customGitHost = { sentinel: true } as never
    const container = createTestContainer({ gitHost: customGitHost })

    expect(container.gitHost).toBe(customGitHost)
    // Other keys should still be the defaults
    expect(container.graphStore).toBeDefined()
    expect(container.relationalStore).toBeDefined()
  })

  it("returns fresh instances on each call", () => {
    const a = createTestContainer()
    const b = createTestContainer()
    expect(a.graphStore).not.toBe(b.graphStore)
    expect(a.cacheStore).not.toBe(b.cacheStore)
  })

  it("all healthCheck ports return up status", async () => {
    const container = createTestContainer()
    const healthPorts = [
      container.graphStore,
      container.relationalStore,
      container.workflowEngine,
      container.cacheStore,
      container.observability,
    ] as Array<{ healthCheck: () => Promise<{ status: string }> }>

    for (const port of healthPorts) {
      const health = await port.healthCheck()
      expect(health.status).toBe("up")
    }
  })
})
