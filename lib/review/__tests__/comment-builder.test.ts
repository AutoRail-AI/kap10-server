import { describe, expect, it } from "vitest"
import type {
  ComplexityFinding,
  DependencyFinding,
  ImpactFinding,
  PatternFinding,
  ReviewConfig,
  TestFinding,
} from "@/lib/ports/types"
import { DEFAULT_REVIEW_CONFIG } from "@/lib/ports/types"
import { buildReviewResult } from "@/lib/review/comment-builder"

function makeConfig(overrides?: Partial<ReviewConfig>): ReviewConfig {
  return { ...DEFAULT_REVIEW_CONFIG, ...overrides }
}

function makePatternFinding(severity: "info" | "warning" | "error"): PatternFinding {
  return {
    ruleId: "rule-1",
    ruleTitle: "Test Rule",
    filePath: "src/foo.ts",
    line: 10,
    message: "Violation message",
    severity,
    suggestion: null,
    autoFix: null,
  }
}

function makeImpactFinding(): ImpactFinding {
  return {
    entityId: "fn-1",
    entityName: "processPayment",
    filePath: "src/payments.ts",
    line: 42,
    callerCount: 20,
    topCallers: [
      { name: "checkoutHandler", filePath: "src/checkout.ts" },
      { name: "refundHandler", filePath: "src/refund.ts" },
    ],
  }
}

function makeTestFinding(): TestFinding {
  return {
    filePath: "src/utils.ts",
    expectedTestPath: "src/utils.test.ts",
    message: "No test companion found for utils.ts",
  }
}

function makeComplexityFinding(): ComplexityFinding {
  return {
    entityId: "fn-complex",
    entityName: "parseConfig",
    filePath: "src/config.ts",
    line: 5,
    complexity: 15,
    threshold: 10,
  }
}

function makeDependencyFinding(): DependencyFinding {
  return {
    filePath: "src/index.ts",
    importPath: "some-new-package",
    line: 1,
    message: "New external dependency: some-new-package",
  }
}

describe("buildReviewResult", () => {
  it("returns APPROVE when there are no findings and autoApproveOnClean is true", () => {
    const config = makeConfig({ autoApproveOnClean: true })
    const result = buildReviewResult([], [], [], [], [], config)

    expect(result.action).toBe("APPROVE")
    expect(result.comments).toHaveLength(0)
    expect(result.checksPassed).toBe(0)
    expect(result.checksWarned).toBe(0)
    expect(result.checksFailed).toBe(0)
    expect(result.autoApproved).toBe(false)
    expect(result.body).toContain("No findings")
  })

  it("returns COMMENT when there are no findings and autoApproveOnClean is false", () => {
    const config = makeConfig({ autoApproveOnClean: false })
    const result = buildReviewResult([], [], [], [], [], config)

    expect(result.action).toBe("COMMENT")
    expect(result.comments).toHaveLength(0)
  })

  it("returns REQUEST_CHANGES when there is an error-severity pattern finding", () => {
    const config = makeConfig()
    const patternFindings: PatternFinding[] = [makePatternFinding("error")]

    const result = buildReviewResult(patternFindings, [], [], [], [], config)

    expect(result.action).toBe("REQUEST_CHANGES")
    expect(result.checksFailed).toBe(1)
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]?.severity).toBe("error")
    expect(result.comments[0]?.checkType).toBe("pattern")
  })

  it("returns COMMENT when there are only warning-severity findings", () => {
    const config = makeConfig({ autoApproveOnClean: false })
    const patternFindings: PatternFinding[] = [makePatternFinding("warning")]

    const result = buildReviewResult(patternFindings, [], [], [], [], config)

    expect(result.action).toBe("COMMENT")
    expect(result.checksWarned).toBe(1)
    expect(result.checksFailed).toBe(0)
  })

  it("counts info findings as checksPassed", () => {
    const config = makeConfig()
    const patternFindings: PatternFinding[] = [makePatternFinding("info")]
    const dependencyFindings: DependencyFinding[] = [makeDependencyFinding()]

    const result = buildReviewResult(patternFindings, [], [], [], dependencyFindings, config)

    // info-severity pattern + info-level dependency
    expect(result.checksPassed).toBe(2)
    expect(result.checksWarned).toBe(0)
    expect(result.checksFailed).toBe(0)
  })

  it("REQUEST_CHANGES takes priority over warnings", () => {
    const config = makeConfig()
    const patternFindings: PatternFinding[] = [
      makePatternFinding("error"),
      makePatternFinding("warning"),
    ]

    const result = buildReviewResult(patternFindings, [], [], [], [], config)

    expect(result.action).toBe("REQUEST_CHANGES")
    expect(result.checksFailed).toBe(1)
    expect(result.checksWarned).toBe(1)
  })

  it("impact findings produce warning-severity comments", () => {
    const config = makeConfig()
    const impactFindings: ImpactFinding[] = [makeImpactFinding()]

    const result = buildReviewResult([], impactFindings, [], [], [], config)

    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]?.severity).toBe("warning")
    expect(result.comments[0]?.checkType).toBe("impact")
    expect(result.checksWarned).toBe(1)
  })

  it("test findings produce warning-severity comments at line 1", () => {
    const config = makeConfig()
    const testFindings: TestFinding[] = [makeTestFinding()]

    const result = buildReviewResult([], [], testFindings, [], [], config)

    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]?.severity).toBe("warning")
    expect(result.comments[0]?.checkType).toBe("test")
    expect(result.comments[0]?.line).toBe(1)
  })

  it("complexity findings produce warning-severity comments", () => {
    const config = makeConfig()
    const complexityFindings: ComplexityFinding[] = [makeComplexityFinding()]

    const result = buildReviewResult([], [], [], complexityFindings, [], config)

    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]?.severity).toBe("warning")
    expect(result.comments[0]?.checkType).toBe("complexity")
  })

  it("dependency findings produce info-severity comments", () => {
    const config = makeConfig()
    const dependencyFindings: DependencyFinding[] = [makeDependencyFinding()]

    const result = buildReviewResult([], [], [], [], dependencyFindings, config)

    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]?.severity).toBe("info")
    expect(result.comments[0]?.checkType).toBe("dependency")
  })

  it("caps comments at 50 when more than 50 findings are passed", () => {
    const config = makeConfig()
    // Create 60 pattern findings
    const patternFindings: PatternFinding[] = Array.from({ length: 60 }, (_, i) => ({
      ruleId: `rule-${i}`,
      ruleTitle: `Rule ${i}`,
      filePath: `src/file${i}.ts`,
      line: i + 1,
      message: `Violation ${i}`,
      severity: "warning" as const,
      suggestion: null,
      autoFix: null,
    }))

    const result = buildReviewResult(patternFindings, [], [], [], [], config)

    expect(result.comments).toHaveLength(50)
    expect(result.checksWarned).toBe(60) // count is based on all, not capped
    expect(result.body).toContain("50")
    expect(result.body).toContain("60")
  })

  it("semanticLgtm APPROVE overrides warnings when semanticLgtmEnabled is true", () => {
    const config = makeConfig({ semanticLgtmEnabled: true })
    const patternFindings: PatternFinding[] = [makePatternFinding("warning")]

    const result = buildReviewResult(patternFindings, [], [], [], [], config, {
      autoApprove: true,
      reason: "All horizontal, low callers",
    })

    expect(result.action).toBe("APPROVE")
    expect(result.autoApproved).toBe(true)
  })

  it("semanticLgtm does NOT override error-severity findings", () => {
    const config = makeConfig({ semanticLgtmEnabled: true })
    const patternFindings: PatternFinding[] = [makePatternFinding("error")]

    const result = buildReviewResult(patternFindings, [], [], [], [], config, {
      autoApprove: true,
      reason: "All horizontal, low callers",
    })

    // Errors always trump semanticLgtm
    expect(result.action).toBe("REQUEST_CHANGES")
    expect(result.autoApproved).toBe(false)
  })

  it("semanticLgtm is ignored when semanticLgtmEnabled is false in config", () => {
    const config = makeConfig({ semanticLgtmEnabled: false, autoApproveOnClean: false })
    const patternFindings: PatternFinding[] = [makePatternFinding("warning")]

    const result = buildReviewResult(patternFindings, [], [], [], [], config, {
      autoApprove: true,
      reason: "All horizontal",
    })

    expect(result.action).toBe("COMMENT")
    expect(result.autoApproved).toBe(false)
  })

  it("body contains summary counts for mixed findings", () => {
    const config = makeConfig()
    const patternFindings: PatternFinding[] = [
      makePatternFinding("error"),
      makePatternFinding("warning"),
    ]
    const dependencyFindings: DependencyFinding[] = [makeDependencyFinding()]

    const result = buildReviewResult(patternFindings, [], [], [], dependencyFindings, config)

    expect(result.body).toContain("3 finding(s)")
    expect(result.body).toContain("blocking")
    expect(result.body).toContain("warnings")
    expect(result.body).toContain("info")
  })
})
