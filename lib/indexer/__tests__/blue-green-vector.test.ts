/**
 * P5-TEST-01f: Blue/green pgvector switching.
 * Tests the concept of maintaining two vector index "slots" and switching
 * the active slot so readers always see a consistent snapshot.
 *
 * Uses InMemoryVectorSearch to model the dual-slot pattern.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { InMemoryVectorSearch } from "@/lib/di/fakes"

/**
 * Minimal blue/green vector manager that wraps two InMemoryVectorSearch instances.
 * Writes go to the inactive ("staging") slot; reads come from the active slot.
 * After a swap, the old staging becomes active and the old active becomes staging.
 */
class BlueGreenVectorManager {
  private slots: { blue: InMemoryVectorSearch; green: InMemoryVectorSearch }
  private activeSlot: "blue" | "green"

  constructor() {
    this.slots = {
      blue: new InMemoryVectorSearch(),
      green: new InMemoryVectorSearch(),
    }
    this.activeSlot = "blue"
  }

  /** Returns the slot name that is currently serving reads. */
  getActiveSlotName(): "blue" | "green" {
    return this.activeSlot
  }

  /** Returns the slot that is currently serving reads. */
  getActiveSlot(): InMemoryVectorSearch {
    return this.slots[this.activeSlot]
  }

  /** Returns the slot used for staging writes (the inactive one). */
  getStagingSlot(): InMemoryVectorSearch {
    return this.activeSlot === "blue" ? this.slots.green : this.slots.blue
  }

  /** Get a specific slot by name (for verifying old data). */
  getSlot(name: "blue" | "green"): InMemoryVectorSearch {
    return this.slots[name]
  }

  /** Swap the active/staging slots. After this, reads come from the other slot. */
  swap(): void {
    this.activeSlot = this.activeSlot === "blue" ? "green" : "blue"
  }

  /** Write embeddings into the staging slot. */
  async writeToStaging(
    ids: string[],
    embeddings: number[][],
    metadata: Record<string, unknown>[]
  ): Promise<void> {
    await this.getStagingSlot().upsert(ids, embeddings, metadata)
  }

  /** Search in the active slot (the one serving reads). */
  async searchActive(
    embedding: number[],
    topK: number,
    filter?: { orgId?: string; repoId?: string }
  ): Promise<{ id: string; score: number; metadata?: Record<string, unknown> }[]> {
    return this.getActiveSlot().search(embedding, topK, filter)
  }
}

describe("BlueGreenVectorManager", () => {
  let manager: BlueGreenVectorManager

  beforeEach(() => {
    manager = new BlueGreenVectorManager()
  })

  it("starts with blue as the active slot", () => {
    expect(manager.getActiveSlotName()).toBe("blue")
  })

  it("writes to staging (green) do not appear in active (blue) reads", async () => {
    const embedding = new Array<number>(768).fill(0.1)
    await manager.writeToStaging(
      ["entity-1"],
      [embedding],
      [{ orgId: "org-1", repoId: "repo-1", name: "stagedFunction" }]
    )

    // Active slot (blue) should have nothing
    const results = await manager.searchActive(embedding, 10, { orgId: "org-1" })
    expect(results).toHaveLength(0)
  })

  it("after swap, previously staged data becomes searchable", async () => {
    const embedding = new Array<number>(768).fill(0.1)
    await manager.writeToStaging(
      ["entity-1"],
      [embedding],
      [{ orgId: "org-1", repoId: "repo-1", name: "stagedFunction" }]
    )

    // Swap: green becomes active
    manager.swap()
    expect(manager.getActiveSlotName()).toBe("green")

    // Now search in the active slot — should find the data
    const results = await manager.searchActive(embedding, 10, { orgId: "org-1" })
    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe("entity-1")
    expect(results[0]!.metadata!.name).toBe("stagedFunction")
  })

  it("old data in the previous active slot (blue) remains accessible via getSlot", async () => {
    // Seed blue with data before swap
    const blueEmbedding = new Array<number>(768).fill(0.2)
    await manager.getSlot("blue").upsert(
      ["blue-entity"],
      [blueEmbedding],
      [{ orgId: "org-1", repoId: "repo-1", name: "blueFunction" }]
    )

    // Stage new data in green
    const greenEmbedding = new Array<number>(768).fill(0.3)
    await manager.writeToStaging(
      ["green-entity"],
      [greenEmbedding],
      [{ orgId: "org-1", repoId: "repo-1", name: "greenFunction" }]
    )

    // Swap: green becomes active
    manager.swap()

    // Blue data is still accessible directly
    const blueResults = await manager.getSlot("blue").search(blueEmbedding, 10, { orgId: "org-1" })
    expect(blueResults).toHaveLength(1)
    expect(blueResults[0]!.id).toBe("blue-entity")

    // Active reads serve green data
    const activeResults = await manager.searchActive(greenEmbedding, 10, { orgId: "org-1" })
    expect(activeResults).toHaveLength(1)
    expect(activeResults[0]!.id).toBe("green-entity")
  })

  it("double swap restores original active slot", async () => {
    const embedding = new Array<number>(768).fill(0.1)
    await manager.getSlot("blue").upsert(
      ["original-entity"],
      [embedding],
      [{ orgId: "org-1", repoId: "repo-1", name: "original" }]
    )

    manager.swap() // green active
    manager.swap() // blue active again

    expect(manager.getActiveSlotName()).toBe("blue")
    const results = await manager.searchActive(embedding, 10, { orgId: "org-1" })
    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe("original-entity")
  })

  it("staging writes after swap go to the new staging (blue)", async () => {
    // Initial: blue active, green staging
    manager.swap() // green active, blue staging

    const embedding = new Array<number>(768).fill(0.5)
    await manager.writeToStaging(
      ["staged-after-swap"],
      [embedding],
      [{ orgId: "org-1", repoId: "repo-1", name: "newStaged" }]
    )

    // The write went to blue (now staging)
    const blueResults = await manager.getSlot("blue").search(embedding, 10, { orgId: "org-1" })
    expect(blueResults).toHaveLength(1)
    expect(blueResults[0]!.id).toBe("staged-after-swap")

    // Green (active) should not have it
    const greenResults = await manager.getSlot("green").search(embedding, 10, { orgId: "org-1" })
    expect(greenResults).toHaveLength(0)
  })

  it("respects org/repo filters during search", async () => {
    const embedding = new Array<number>(768).fill(0.1)

    // Write data for two different repos into blue
    await manager.getSlot("blue").upsert(
      ["entity-a", "entity-b"],
      [embedding, embedding],
      [
        { orgId: "org-1", repoId: "repo-1", name: "repoOneEntity" },
        { orgId: "org-1", repoId: "repo-2", name: "repoTwoEntity" },
      ]
    )

    // Search should filter by repoId
    const repo1Results = await manager.searchActive(embedding, 10, { orgId: "org-1", repoId: "repo-1" })
    expect(repo1Results).toHaveLength(1)
    expect(repo1Results[0]!.id).toBe("entity-a")

    const repo2Results = await manager.searchActive(embedding, 10, { orgId: "org-1", repoId: "repo-2" })
    expect(repo2Results).toHaveLength(1)
    expect(repo2Results[0]!.id).toBe("entity-b")
  })
})
