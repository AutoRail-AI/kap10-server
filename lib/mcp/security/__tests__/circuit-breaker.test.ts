import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { recordBrokenEntry, isCircuitTripped, resetCircuitBreaker } from "../circuit-breaker"

describe("Circuit Breaker", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
    process.env.CIRCUIT_BREAKER_ENABLED = "true"
    process.env.CIRCUIT_BREAKER_THRESHOLD = "3"
  })

  it("does not trip below threshold", async () => {
    const r1 = await recordBrokenEntry(container, "org-1", "repo-1", ["entity-1"])
    expect(r1.tripped).toBe(false)

    const r2 = await recordBrokenEntry(container, "org-1", "repo-1", ["entity-1"])
    expect(r2.tripped).toBe(false)
  })

  it("trips at threshold", async () => {
    for (let i = 0; i < 3; i++) {
      await recordBrokenEntry(container, "org-1", "repo-1", ["entity-2"])
    }
    const r = await recordBrokenEntry(container, "org-1", "repo-1", ["entity-2"])
    expect(r.tripped).toBe(true)
    expect(r.trippedEntities).toContain("entity-2")
  })

  it("isCircuitTripped returns true when tripped", async () => {
    for (let i = 0; i < 4; i++) {
      await recordBrokenEntry(container, "org-1", "repo-1", ["entity-3"])
    }
    const tripped = await isCircuitTripped(container, "org-1", "repo-1", "entity-3")
    expect(tripped).toBe(true)
  })

  it("resets circuit breaker", async () => {
    for (let i = 0; i < 4; i++) {
      await recordBrokenEntry(container, "org-1", "repo-1", ["entity-4"])
    }
    await resetCircuitBreaker(container, "org-1", "repo-1", "entity-4")
    const tripped = await isCircuitTripped(container, "org-1", "repo-1", "entity-4")
    expect(tripped).toBe(false)
  })

  it("does nothing when disabled", async () => {
    process.env.CIRCUIT_BREAKER_ENABLED = "false"
    for (let i = 0; i < 10; i++) {
      const r = await recordBrokenEntry(container, "org-1", "repo-1", ["entity-5"])
      expect(r.tripped).toBe(false)
    }
  })
})
