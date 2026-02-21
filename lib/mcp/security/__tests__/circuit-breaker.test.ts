import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import {
  recordBrokenEntry,
  isCircuitTripped,
  resetCircuitBreaker,
  checkCircuitBreakers,
} from "../circuit-breaker"

describe("Circuit Breaker", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
    process.env.CIRCUIT_BREAKER_ENABLED = "true"
    process.env.CIRCUIT_BREAKER_THRESHOLD = "4"
    process.env.CIRCUIT_BREAKER_WINDOW_MINUTES = "10"
    process.env.CIRCUIT_BREAKER_COOLDOWN_MINUTES = "5"
  })

  it("passes when under threshold", async () => {
    const r1 = await recordBrokenEntry(container, "org-1", "repo-1", ["entity-1"])
    expect(r1.tripped).toBe(false)
    expect(r1.trippedEntities.length).toBe(0)

    const r2 = await recordBrokenEntry(container, "org-1", "repo-1", ["entity-1"])
    expect(r2.tripped).toBe(false)

    const r3 = await recordBrokenEntry(container, "org-1", "repo-1", ["entity-1"])
    expect(r3.tripped).toBe(false)
  })

  it("trips at threshold (4 broken entries in window)", async () => {
    // Record 4 broken entries for the same entity (threshold is 4)
    for (let i = 0; i < 4; i++) {
      await recordBrokenEntry(container, "org-1", "repo-1", ["entity-trip"])
    }

    // The 5th should trip the breaker
    const result = await recordBrokenEntry(container, "org-1", "repo-1", ["entity-trip"])
    expect(result.tripped).toBe(true)
    expect(result.trippedEntities).toContain("entity-trip")

    // Verify isCircuitTripped agrees
    const tripped = await isCircuitTripped(container, "org-1", "repo-1", "entity-trip")
    expect(tripped).toBe(true)
  })

  it("manual reset works and clears tripped state", async () => {
    // Trip the breaker
    for (let i = 0; i < 5; i++) {
      await recordBrokenEntry(container, "org-1", "repo-1", ["entity-reset"])
    }

    const trippedBefore = await isCircuitTripped(container, "org-1", "repo-1", "entity-reset")
    expect(trippedBefore).toBe(true)

    // Reset
    await resetCircuitBreaker(container, "org-1", "repo-1", "entity-reset")

    const trippedAfter = await isCircuitTripped(container, "org-1", "repo-1", "entity-reset")
    expect(trippedAfter).toBe(false)
  })

  it("different entities tracked independently", async () => {
    // Trip entity-A
    for (let i = 0; i < 5; i++) {
      await recordBrokenEntry(container, "org-1", "repo-1", ["entity-A"])
    }

    // entity-B is under threshold
    await recordBrokenEntry(container, "org-1", "repo-1", ["entity-B"])
    await recordBrokenEntry(container, "org-1", "repo-1", ["entity-B"])

    const trippedA = await isCircuitTripped(container, "org-1", "repo-1", "entity-A")
    const trippedB = await isCircuitTripped(container, "org-1", "repo-1", "entity-B")

    expect(trippedA).toBe(true)
    expect(trippedB).toBe(false)
  })

  it("checkCircuitBreakers reports blocked entities", async () => {
    // Trip entity-x
    for (let i = 0; i < 5; i++) {
      await recordBrokenEntry(container, "org-1", "repo-1", ["entity-x"])
    }

    const result = await checkCircuitBreakers(container, "org-1", "repo-1", [
      "entity-x",
      "entity-y",
    ])

    expect(result.blocked).toBe(true)
    expect(result.blockedEntities).toContain("entity-x")
    expect(result.blockedEntities).not.toContain("entity-y")
  })

  it("does nothing when disabled", async () => {
    process.env.CIRCUIT_BREAKER_ENABLED = "false"

    for (let i = 0; i < 20; i++) {
      const r = await recordBrokenEntry(container, "org-1", "repo-1", ["entity-disabled"])
      expect(r.tripped).toBe(false)
    }

    const tripped = await isCircuitTripped(container, "org-1", "repo-1", "entity-disabled")
    expect(tripped).toBe(false)

    const check = await checkCircuitBreakers(container, "org-1", "repo-1", ["entity-disabled"])
    expect(check.blocked).toBe(false)
  })

  it("handles multiple entities in single recordBrokenEntry call", async () => {
    // Trip entity-m1 but not entity-m2
    for (let i = 0; i < 4; i++) {
      await recordBrokenEntry(container, "org-1", "repo-1", ["entity-m1"])
    }

    // Now break both in one call — only m1 should trip
    const result = await recordBrokenEntry(container, "org-1", "repo-1", ["entity-m1", "entity-m2"])
    expect(result.tripped).toBe(true)
    expect(result.trippedEntities).toContain("entity-m1")
    expect(result.trippedEntities).not.toContain("entity-m2")
  })
})
