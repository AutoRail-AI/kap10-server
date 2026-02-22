import { describe, it, expect, beforeEach } from "vitest"
import { createTestContainer, type Container } from "@/lib/di/container"
import { runImpactCheck } from "../impact-check"
import type { EntityDoc, ReviewConfig } from "@/lib/ports/types"
import { DEFAULT_REVIEW_CONFIG } from "@/lib/ports/types"

const ORG = "org-impact-check"
const REPO = "repo-impact"

function makeConfig(overrides: Partial<ReviewConfig> = {}): ReviewConfig {
  return { ...DEFAULT_REVIEW_CONFIG, ...overrides }
}

function makeEntity(
  id: string,
  overrides: Partial<EntityDoc> = {}
): EntityDoc & { changedLines: Array<{ start: number; end: number }> } {
  return {
    id,
    org_id: ORG,
    repo_id: REPO,
    kind: "function",
    name: `fn_${id}`,
    file_path: `lib/${id}.ts`,
    start_line: 10,
    ...overrides,
    changedLines: [{ start: 10, end: 20 }],
  }
}

describe("runImpactCheck", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
  })

  it("returns empty array when impact check is disabled", async () => {
    const entity = makeEntity("fn-a")
    await container.graphStore.upsertEntity(ORG, entity)

    const config = makeConfig({ checksEnabled: { ...DEFAULT_REVIEW_CONFIG.checksEnabled, impact: false } })
    const findings = await runImpactCheck(ORG, [entity], container.graphStore, config)

    expect(findings).toHaveLength(0)
  })

  it("returns empty array when no entities are provided", async () => {
    const config = makeConfig({ impactThreshold: 5 })
    const findings = await runImpactCheck(ORG, [], container.graphStore, config)

    expect(findings).toHaveLength(0)
  })

  it("generates a finding when callerCount meets or exceeds the threshold", async () => {
    // Entity under review
    const target = makeEntity("target-fn")
    await container.graphStore.upsertEntity(ORG, target)

    // Upsert 5 caller entities
    for (let i = 0; i < 5; i++) {
      const caller = makeEntity(`caller-${i}`)
      await container.graphStore.upsertEntity(ORG, caller)
      await container.graphStore.upsertEdge(ORG, {
        _from: `functions/caller-${i}`,
        _to: `functions/target-fn`,
        kind: "calls",
        org_id: ORG,
        repo_id: REPO,
      })
    }

    const config = makeConfig({ impactThreshold: 5 })
    const findings = await runImpactCheck(ORG, [target], container.graphStore, config)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.entityId).toBe("target-fn")
    expect(findings[0]!.callerCount).toBe(5)
    expect(findings[0]!.entityName).toBe("fn_target-fn")
    expect(findings[0]!.filePath).toBe("lib/target-fn.ts")
  })

  it("does not generate a finding when callerCount is below threshold", async () => {
    const target = makeEntity("low-impact-fn")
    await container.graphStore.upsertEntity(ORG, target)

    // Only 2 callers
    for (let i = 0; i < 2; i++) {
      const caller = makeEntity(`sparse-caller-${i}`)
      await container.graphStore.upsertEntity(ORG, caller)
      await container.graphStore.upsertEdge(ORG, {
        _from: `functions/sparse-caller-${i}`,
        _to: `functions/low-impact-fn`,
        kind: "calls",
        org_id: ORG,
        repo_id: REPO,
      })
    }

    const config = makeConfig({ impactThreshold: 15 })
    const findings = await runImpactCheck(ORG, [target], container.graphStore, config)

    expect(findings).toHaveLength(0)
  })

  it("caps topCallers to 5 entries even when there are more callers", async () => {
    const target = makeEntity("popular-fn")
    await container.graphStore.upsertEntity(ORG, target)

    // Upsert 10 caller entities
    for (let i = 0; i < 10; i++) {
      const caller = makeEntity(`top-caller-${i}`)
      await container.graphStore.upsertEntity(ORG, caller)
      await container.graphStore.upsertEdge(ORG, {
        _from: `functions/top-caller-${i}`,
        _to: `functions/popular-fn`,
        kind: "calls",
        org_id: ORG,
        repo_id: REPO,
      })
    }

    const config = makeConfig({ impactThreshold: 5 })
    const findings = await runImpactCheck(ORG, [target], container.graphStore, config)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.callerCount).toBe(10)
    expect(findings[0]!.topCallers.length).toBeLessThanOrEqual(5)
  })

  it("returns a finding per affected entity that meets the threshold", async () => {
    const entityA = makeEntity("fn-multi-a")
    const entityB = makeEntity("fn-multi-b")
    await container.graphStore.upsertEntity(ORG, entityA)
    await container.graphStore.upsertEntity(ORG, entityB)

    // 3 callers for entityA (below threshold of 5)
    for (let i = 0; i < 3; i++) {
      const caller = makeEntity(`callerA-${i}`)
      await container.graphStore.upsertEntity(ORG, caller)
      await container.graphStore.upsertEdge(ORG, {
        _from: `functions/callerA-${i}`,
        _to: `functions/fn-multi-a`,
        kind: "calls",
        org_id: ORG,
        repo_id: REPO,
      })
    }

    // 7 callers for entityB (above threshold of 5)
    for (let i = 0; i < 7; i++) {
      const caller = makeEntity(`callerB-${i}`)
      await container.graphStore.upsertEntity(ORG, caller)
      await container.graphStore.upsertEdge(ORG, {
        _from: `functions/callerB-${i}`,
        _to: `functions/fn-multi-b`,
        kind: "calls",
        org_id: ORG,
        repo_id: REPO,
      })
    }

    const config = makeConfig({ impactThreshold: 5 })
    const findings = await runImpactCheck(ORG, [entityA, entityB], container.graphStore, config)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.entityId).toBe("fn-multi-b")
    expect(findings[0]!.callerCount).toBe(7)
  })

  it("uses start_line from entity for the line field in the finding", async () => {
    const target = makeEntity("line-check-fn", { start_line: 42 })
    await container.graphStore.upsertEntity(ORG, target)

    for (let i = 0; i < 5; i++) {
      const caller = makeEntity(`line-caller-${i}`)
      await container.graphStore.upsertEntity(ORG, caller)
      await container.graphStore.upsertEdge(ORG, {
        _from: `functions/line-caller-${i}`,
        _to: `functions/line-check-fn`,
        kind: "calls",
        org_id: ORG,
        repo_id: REPO,
      })
    }

    const config = makeConfig({ impactThreshold: 5 })
    const findings = await runImpactCheck(ORG, [target], container.graphStore, config)

    expect(findings[0]!.line).toBe(42)
  })
})
