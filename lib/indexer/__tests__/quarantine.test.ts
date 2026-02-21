import { describe, it, expect } from "vitest"
import {
  withQuarantine,
  isQuarantined,
  shouldHealQuarantine,
} from "@/lib/indexer/quarantine"
import type { EntityDoc } from "@/lib/ports/types"

function makeEntity(overrides: Partial<EntityDoc> & { id: string }): EntityDoc {
  return {
    org_id: "org-1",
    repo_id: "repo-1",
    kind: "function",
    name: "test",
    file_path: "src/index.ts",
    ...overrides,
  }
}

describe("withQuarantine", () => {
  it("passes through normal extraction", async () => {
    const entities: EntityDoc[] = [
      makeEntity({ id: "e1", name: "foo" }),
      makeEntity({ id: "e2", name: "bar" }),
    ]

    const result = await withQuarantine(
      "src/index.ts",
      1000, // small file size
      "org-1",
      "repo-1",
      async () => entities,
      { maxFileSize: 5_000_000, timeoutMs: 30_000 }
    )

    expect(result.entities).toEqual(entities)
    expect(result.quarantined).toHaveLength(0)
  })

  it("quarantines files exceeding max size", async () => {
    const result = await withQuarantine(
      "src/huge-file.ts",
      10_000_000, // 10MB, exceeds default 5MB
      "org-1",
      "repo-1",
      async () => [],
      { maxFileSize: 5_000_000, timeoutMs: 30_000 }
    )

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]!._quarantined).toBe(true)
    expect(result.entities[0]!._quarantine_reason).toBe("file_too_large")
    expect(result.quarantined).toHaveLength(1)
    expect(result.quarantined[0]!.filePath).toBe("src/huge-file.ts")
    expect(result.quarantined[0]!.reason).toContain("10000000")
  })

  it("quarantines on extraction timeout", async () => {
    const result = await withQuarantine(
      "src/slow-file.ts",
      100, // small file
      "org-1",
      "repo-1",
      () => new Promise<EntityDoc[]>((resolve) => {
        // Never resolves within timeout
        setTimeout(() => resolve([]), 60_000)
      }),
      { maxFileSize: 5_000_000, timeoutMs: 50 } // Very short timeout
    )

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]!._quarantined).toBe(true)
    expect(result.entities[0]!._quarantine_reason).toBe("extraction_timeout")
    expect(result.quarantined).toHaveLength(1)
    expect(result.quarantined[0]!.reason).toBe("extraction_timeout")
  })
})

describe("isQuarantined", () => {
  it("returns true for quarantined entities", () => {
    const entity = makeEntity({ id: "q1", _quarantined: true, _quarantine_reason: "file_too_large" })
    expect(isQuarantined(entity)).toBe(true)
  })

  it("returns false for normal entities", () => {
    const entity = makeEntity({ id: "n1" })
    expect(isQuarantined(entity)).toBe(false)
  })

  it("returns false when _quarantined is explicitly false", () => {
    const entity = makeEntity({ id: "n2", _quarantined: false })
    expect(isQuarantined(entity)).toBe(false)
  })
})

describe("shouldHealQuarantine", () => {
  it("detects healed files", () => {
    const existing: EntityDoc[] = [
      makeEntity({
        id: "q1",
        file_path: "src/problem.ts",
        _quarantined: true,
        _quarantine_reason: "extraction_timeout",
      }),
      makeEntity({ id: "e1", file_path: "src/ok.ts" }),
    ]

    const newEntities: EntityDoc[] = [
      // The previously quarantined file now extracts successfully
      makeEntity({ id: "fixed1", file_path: "src/problem.ts", name: "fixedFunc" }),
      makeEntity({ id: "e1", file_path: "src/ok.ts" }),
    ]

    const healed = shouldHealQuarantine(existing, newEntities)
    expect(healed).toEqual(["src/problem.ts"])
  })

  it("returns empty when no quarantined files are healed", () => {
    const existing: EntityDoc[] = [
      makeEntity({
        id: "q1",
        file_path: "src/still-broken.ts",
        _quarantined: true,
        _quarantine_reason: "file_too_large",
      }),
    ]

    // New entities don't include the quarantined file path
    const newEntities: EntityDoc[] = [
      makeEntity({ id: "e2", file_path: "src/other.ts" }),
    ]

    const healed = shouldHealQuarantine(existing, newEntities)
    expect(healed).toHaveLength(0)
  })

  it("does not report still-quarantined files as healed", () => {
    const existing: EntityDoc[] = [
      makeEntity({
        id: "q1",
        file_path: "src/problem.ts",
        _quarantined: true,
      }),
    ]

    // New entity for same path is also quarantined
    const newEntities: EntityDoc[] = [
      makeEntity({
        id: "q2",
        file_path: "src/problem.ts",
        _quarantined: true,
      }),
    ]

    const healed = shouldHealQuarantine(existing, newEntities)
    expect(healed).toHaveLength(0)
  })
})
