import { describe, expect, it } from "vitest"
import type { EntityDoc, ReviewConfig } from "@/lib/ports/types"
import { DEFAULT_REVIEW_CONFIG } from "@/lib/ports/types"
import { runComplexityCheck } from "../complexity-check"

const ORG = "org-complexity"
const REPO = "repo-complexity"

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
    start_line: 1,
    cyclomatic_complexity: 5,
    ...overrides,
    changedLines: [{ start: 1, end: 30 }],
  }
}

describe("runComplexityCheck", () => {
  it("returns empty array when complexity check is disabled", async () => {
    const entity = makeEntity("disabled-fn", { cyclomatic_complexity: 20 })
    const config = makeConfig({
      checksEnabled: { ...DEFAULT_REVIEW_CONFIG.checksEnabled, complexity: false },
    })

    const findings = await runComplexityCheck([entity], config)
    expect(findings).toHaveLength(0)
  })

  it("returns empty array when no entities are provided", async () => {
    const config = makeConfig({ complexityThreshold: 10 })
    const findings = await runComplexityCheck([], config)
    expect(findings).toHaveLength(0)
  })

  it("generates a finding for a function above the complexity threshold", async () => {
    const entity = makeEntity("complex-fn", { cyclomatic_complexity: 15, start_line: 20 })
    const config = makeConfig({ complexityThreshold: 10 })

    const findings = await runComplexityCheck([entity], config)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.entityId).toBe("complex-fn")
    expect(findings[0]!.entityName).toBe("fn_complex-fn")
    expect(findings[0]!.filePath).toBe("lib/complex-fn.ts")
    expect(findings[0]!.complexity).toBe(15)
    expect(findings[0]!.threshold).toBe(10)
    expect(findings[0]!.line).toBe(20)
  })

  it("generates a finding when complexity equals the threshold exactly", async () => {
    const entity = makeEntity("threshold-fn", { cyclomatic_complexity: 10 })
    const config = makeConfig({ complexityThreshold: 10 })

    const findings = await runComplexityCheck([entity], config)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.complexity).toBe(10)
  })

  it("does not generate a finding when complexity is below the threshold", async () => {
    const entity = makeEntity("simple-fn", { cyclomatic_complexity: 3 })
    const config = makeConfig({ complexityThreshold: 10 })

    const findings = await runComplexityCheck([entity], config)

    expect(findings).toHaveLength(0)
  })

  it("does not generate a finding when cyclomatic_complexity is 0 or missing", async () => {
    const entityZero = makeEntity("zero-fn", { cyclomatic_complexity: 0 })
    const entityMissing = makeEntity("missing-fn")
    delete (entityMissing as Record<string, unknown>).cyclomatic_complexity

    const config = makeConfig({ complexityThreshold: 1 })

    const findingsZero = await runComplexityCheck([entityZero], config)
    const findingsMissing = await runComplexityCheck([entityMissing], config)

    expect(findingsZero).toHaveLength(0)
    expect(findingsMissing).toHaveLength(0)
  })

  it("skips entities that are not functions or methods", async () => {
    const classEntity = makeEntity("ComplexClass", {
      kind: "class",
      cyclomatic_complexity: 25,
    })
    const fileEntity = makeEntity("big-file", {
      kind: "file",
      cyclomatic_complexity: 50,
    })

    const config = makeConfig({ complexityThreshold: 10 })

    const findings = await runComplexityCheck([classEntity, fileEntity], config)

    expect(findings).toHaveLength(0)
  })

  it("generates findings for methods as well as functions", async () => {
    const method = makeEntity("my-method", {
      kind: "method",
      cyclomatic_complexity: 12,
    })
    const config = makeConfig({ complexityThreshold: 10 })

    const findings = await runComplexityCheck([method], config)

    expect(findings).toHaveLength(1)
    expect(findings[0]!.entityId).toBe("my-method")
  })

  it("returns one finding per entity that exceeds threshold", async () => {
    const highA = makeEntity("high-a", { cyclomatic_complexity: 20 })
    const lowB = makeEntity("low-b", { cyclomatic_complexity: 4 })
    const highC = makeEntity("high-c", { cyclomatic_complexity: 11 })

    const config = makeConfig({ complexityThreshold: 10 })

    const findings = await runComplexityCheck([highA, lowB, highC], config)

    expect(findings).toHaveLength(2)
    const ids = findings.map((f) => f.entityId)
    expect(ids).toContain("high-a")
    expect(ids).toContain("high-c")
    expect(ids).not.toContain("low-b")
  })

  it("includes correct threshold in the finding output", async () => {
    const entity = makeEntity("threshold-check-fn", { cyclomatic_complexity: 15 })
    const config = makeConfig({ complexityThreshold: 7 })

    const findings = await runComplexityCheck([entity], config)

    expect(findings[0]!.threshold).toBe(7)
  })
})
