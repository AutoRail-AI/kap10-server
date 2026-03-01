import type { EntityDoc } from "@/lib/ports/types"
import { describe, expect, it } from "vitest"
import { extractIntentSignals, extractFromNaming } from "../intent-signals"
import type { TestContext } from "../types"

function makeEntity(overrides: Partial<EntityDoc> & { name: string; file_path: string }): EntityDoc {
  return {
    id: "e1",
    org_id: "org1",
    repo_id: "repo1",
    kind: "function",
    start_line: 1,
    ...overrides,
  } as EntityDoc
}

describe("extractIntentSignals", () => {
  it("populates fromTests when test context has assertions", () => {
    const entity = makeEntity({ name: "processPayment", file_path: "src/payment.ts" })
    const testContext: TestContext = {
      testFiles: ["src/payment.test.ts"],
      assertions: ["should reject expired cards", "should handle partial refunds", "should validate amount"],
    }

    const signals = extractIntentSignals(entity, testContext, undefined, [], [])
    expect(signals.fromTests).toEqual([
      "should reject expired cards",
      "should handle partial refunds",
      "should validate amount",
    ])
  })

  it("caps test assertions at 5", () => {
    const entity = makeEntity({ name: "fn", file_path: "src/fn.ts" })
    const testContext: TestContext = {
      testFiles: ["src/fn.test.ts"],
      assertions: Array.from({ length: 10 }, (_, i) => `assertion ${i}`),
    }

    const signals = extractIntentSignals(entity, testContext, undefined, [], [])
    expect(signals.fromTests.length).toBe(5)
  })

  it("detects entity in API route file", () => {
    const entity = makeEntity({
      name: "POST",
      file_path: "app/api/repos/[repoId]/route.ts",
    })

    const signals = extractIntentSignals(entity, undefined, undefined, [], [])
    expect(signals.fromEntryPoints).toEqual(["API route: /api/repos/[repoId]"])
  })

  it("detects entity in page file as entry point", () => {
    const entity = makeEntity({
      name: "DashboardPage",
      file_path: "app/dashboard/page.tsx",
    })

    const signals = extractIntentSignals(entity, undefined, undefined, [], [])
    expect(signals.fromEntryPoints.length).toBe(1)
    expect(signals.fromEntryPoints[0]).toContain("Entry point")
  })

  it("detects callers from entry point files", () => {
    const entity = makeEntity({ name: "validateInput", file_path: "lib/validate.ts" })
    const neighbors = [
      {
        id: "caller1",
        name: "handleSubmit",
        kind: "function",
        direction: "inbound",
        file_path: "app/api/checkout/route.ts",
      },
    ]

    const signals = extractIntentSignals(entity, undefined, undefined, neighbors, [])
    expect(signals.fromEntryPoints.length).toBe(1)
    expect(signals.fromEntryPoints[0]).toContain("Called from handleSubmit")
  })

  it("filters noise commits from historicalContext", () => {
    const entity = makeEntity({ name: "fn", file_path: "src/fn.ts" })
    const history = [
      "Merge branch 'main' into feature",
      "handle partial refunds for multi-currency",
      "bump version to 2.0.0",
      "fix edge case in payment validation",
    ]

    const signals = extractIntentSignals(entity, undefined, history, [], [])
    expect(signals.fromCommits).toEqual([
      "handle partial refunds for multi-currency",
      "fix edge case in payment validation",
    ])
  })

  it("returns empty signals when no data available", () => {
    const entity = makeEntity({ name: "x", file_path: "src/x.ts" })
    const signals = extractIntentSignals(entity, undefined, undefined, [], [])
    expect(signals.fromTests).toEqual([])
    expect(signals.fromEntryPoints).toEqual([])
    expect(signals.fromNaming).toBeNull()
    expect(signals.fromCommits).toEqual([])
  })
})

describe("extractFromNaming", () => {
  it("converts camelCase to readable intent", () => {
    expect(extractFromNaming("processPayment")).toBe("processes payment")
  })

  it("converts snake_case to readable intent", () => {
    expect(extractFromNaming("validate_user_input")).toBe("validates user input")
  })

  it("converts PascalCase to readable intent", () => {
    expect(extractFromNaming("PaymentProcessor")).toBe("payment processor")
  })

  it("returns null for non-descriptive names", () => {
    expect(extractFromNaming("handle")).toBeNull()
    expect(extractFromNaming("fn")).toBeNull()
    expect(extractFromNaming("x")).toBeNull()
  })

  it("returns null for single-word names without a verb", () => {
    // Single word after split → returns null (less than 2 words)
    expect(extractFromNaming("data")).toBeNull()
  })

  it("handles known verbs", () => {
    expect(extractFromNaming("fetchUserData")).toBe("fetches user data")
    expect(extractFromNaming("buildGraphContext")).toBe("builds graph context")
    expect(extractFromNaming("createBatches")).toBe("creates batches")
  })
})
