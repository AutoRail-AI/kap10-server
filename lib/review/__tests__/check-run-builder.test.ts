import { describe, it, expect } from "vitest"
import { buildCheckRunOutput } from "@/lib/review/check-run-builder"
import type {
  BlastRadiusSummary,
  ComplexityFinding,
  DependencyFinding,
  ImpactFinding,
  PatternFinding,
  TestFinding,
} from "@/lib/ports/types"

function makePatternFinding(severity: "info" | "warning" | "error"): PatternFinding {
  return {
    ruleId: "rule-1",
    ruleTitle: "No Direct DB Access",
    filePath: "src/handler.ts",
    line: 25,
    endLine: 27,
    message: "Direct DB access is forbidden in handlers",
    severity,
    suggestion: "Use repository layer instead",
    autoFix: null,
  }
}

function makeImpactFinding(): ImpactFinding {
  return {
    entityId: "fn-send-email",
    entityName: "sendEmail",
    filePath: "src/email.ts",
    line: 10,
    callerCount: 30,
    topCallers: [
      { name: "onboardUser", filePath: "src/onboarding.ts" },
      { name: "resetPassword", filePath: "src/auth.ts" },
    ],
  }
}

function makeTestFinding(): TestFinding {
  return {
    filePath: "src/utils.ts",
    expectedTestPath: "src/utils.test.ts",
    message: "Missing test companion for utils.ts",
  }
}

function makeComplexityFinding(): ComplexityFinding {
  return {
    entityId: "fn-parse",
    entityName: "parseConfig",
    filePath: "src/config.ts",
    line: 5,
    complexity: 22,
    threshold: 10,
  }
}

function makeDependencyFinding(): DependencyFinding {
  return {
    filePath: "src/index.ts",
    importPath: "lodash",
    line: 3,
    message: "New external dependency: lodash",
  }
}

describe("buildCheckRunOutput", () => {
  it("returns success conclusion and clean title when there are no findings", () => {
    const output = buildCheckRunOutput([], [], [], [], [])

    expect(output.conclusion).toBe("success")
    expect(output.title).toContain("No findings")
    expect(output.annotations).toHaveLength(0)
    expect(output.summary).toContain("No findings")
  })

  it("maps error severity pattern finding to 'failure' annotation level", () => {
    const output = buildCheckRunOutput([makePatternFinding("error")], [], [], [], [])

    expect(output.annotations).toHaveLength(1)
    expect(output.annotations[0]?.annotation_level).toBe("failure")
    expect(output.annotations[0]?.path).toBe("src/handler.ts")
    expect(output.annotations[0]?.start_line).toBe(25)
    expect(output.annotations[0]?.end_line).toBe(27)
  })

  it("maps warning severity pattern finding to 'warning' annotation level", () => {
    const output = buildCheckRunOutput([makePatternFinding("warning")], [], [], [], [])

    expect(output.annotations).toHaveLength(1)
    expect(output.annotations[0]?.annotation_level).toBe("warning")
  })

  it("maps info severity pattern finding to 'notice' annotation level", () => {
    const output = buildCheckRunOutput([makePatternFinding("info")], [], [], [], [])

    expect(output.annotations).toHaveLength(1)
    expect(output.annotations[0]?.annotation_level).toBe("notice")
  })

  it("maps impact findings to 'warning' annotation level", () => {
    const output = buildCheckRunOutput([], [makeImpactFinding()], [], [], [])

    expect(output.annotations).toHaveLength(1)
    expect(output.annotations[0]?.annotation_level).toBe("warning")
    expect(output.annotations[0]?.title).toBe("High Impact Entity")
    expect(output.annotations[0]?.path).toBe("src/email.ts")
  })

  it("maps test findings to 'warning' annotation level at line 1", () => {
    const output = buildCheckRunOutput([], [], [makeTestFinding()], [], [])

    expect(output.annotations).toHaveLength(1)
    expect(output.annotations[0]?.annotation_level).toBe("warning")
    expect(output.annotations[0]?.start_line).toBe(1)
    expect(output.annotations[0]?.end_line).toBe(1)
    expect(output.annotations[0]?.title).toBe("Missing Test Companion")
  })

  it("maps complexity findings to 'warning' annotation level", () => {
    const output = buildCheckRunOutput([], [], [], [makeComplexityFinding()], [])

    expect(output.annotations).toHaveLength(1)
    expect(output.annotations[0]?.annotation_level).toBe("warning")
    expect(output.annotations[0]?.title).toContain("parseConfig")
    expect(output.annotations[0]?.message).toContain("22")
  })

  it("maps dependency findings to 'notice' annotation level", () => {
    const output = buildCheckRunOutput([], [], [], [], [makeDependencyFinding()])

    expect(output.annotations).toHaveLength(1)
    expect(output.annotations[0]?.annotation_level).toBe("notice")
    expect(output.annotations[0]?.title).toBe("New Dependency")
  })

  it("returns 'failure' conclusion when any annotation is a blocker (error)", () => {
    const output = buildCheckRunOutput(
      [makePatternFinding("error"), makePatternFinding("warning")],
      [],
      [],
      [],
      []
    )

    expect(output.conclusion).toBe("failure")
  })

  it("returns 'neutral' conclusion when there are only warnings (no errors)", () => {
    const output = buildCheckRunOutput(
      [makePatternFinding("warning")],
      [makeImpactFinding()],
      [],
      [],
      []
    )

    expect(output.conclusion).toBe("neutral")
  })

  it("returns 'neutral' conclusion when there are only info findings", () => {
    const output = buildCheckRunOutput([], [], [], [], [makeDependencyFinding()])

    // notice level — total > 0, no failures
    expect(output.conclusion).toBe("neutral")
  })

  it("includes check counts in the title when there are findings", () => {
    const output = buildCheckRunOutput(
      [makePatternFinding("error"), makePatternFinding("warning")],
      [],
      [],
      [],
      []
    )

    // 2 total (1 blocker, 1 warning)
    expect(output.title).toContain("2 finding(s)")
    expect(output.title).toContain("1 blocker(s)")
    expect(output.title).toContain("1 warning(s)")
  })

  it("summary markdown contains Pattern Violations section", () => {
    const output = buildCheckRunOutput([makePatternFinding("error")], [], [], [], [])

    expect(output.summary).toContain("Pattern Violations")
    expect(output.summary).toContain("src/handler.ts")
    expect(output.summary).toContain("No Direct DB Access")
  })

  it("summary markdown contains High-Impact Changes section", () => {
    const output = buildCheckRunOutput([], [makeImpactFinding()], [], [], [])

    expect(output.summary).toContain("High-Impact Changes")
    expect(output.summary).toContain("sendEmail")
  })

  it("summary markdown contains Missing Tests section", () => {
    const output = buildCheckRunOutput([], [], [makeTestFinding()], [], [])

    expect(output.summary).toContain("Missing Tests")
    expect(output.summary).toContain("src/utils.ts")
  })

  it("summary markdown contains Complexity Spikes section", () => {
    const output = buildCheckRunOutput([], [], [], [makeComplexityFinding()], [])

    expect(output.summary).toContain("Complexity Spikes")
    expect(output.summary).toContain("parseConfig")
  })

  it("summary markdown contains New Dependencies section", () => {
    const output = buildCheckRunOutput([], [], [], [], [makeDependencyFinding()])

    expect(output.summary).toContain("New Dependencies")
    expect(output.summary).toContain("lodash")
  })

  it("caps annotations at 50 when more than 50 findings are provided", () => {
    const manyFindings: PatternFinding[] = Array.from({ length: 60 }, (_, i) => ({
      ruleId: `rule-${i}`,
      ruleTitle: `Rule ${i}`,
      filePath: `src/file${i}.ts`,
      line: i + 1,
      message: `Violation ${i}`,
      severity: "warning" as const,
      suggestion: null,
      autoFix: null,
    }))

    const output = buildCheckRunOutput(manyFindings, [], [], [], [])

    expect(output.annotations).toHaveLength(50)
  })

  it("appends blast radius section to summary when blastRadius is provided", () => {
    const blastRadius: BlastRadiusSummary[] = [
      {
        entity: "processOrder",
        filePath: "src/orders.ts",
        upstreamBoundaries: [
          {
            name: "POST /api/orders",
            kind: "api_route",
            filePath: "src/api/orders.ts",
            depth: 2,
            path: "processOrder → ... → POST /api/orders",
          },
        ],
        callerCount: 5,
      },
    ]

    const output = buildCheckRunOutput([], [], [], [], [], blastRadius)

    expect(output.summary).toContain("Impact Radius")
    expect(output.summary).toContain("processOrder")
    expect(output.summary).toContain("POST /api/orders")
  })
})
