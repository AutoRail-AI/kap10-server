import { beforeEach, describe, expect, it } from "vitest"
import { type Container, createTestContainer } from "@/lib/di/container"
import type { EntityDoc, RuleDoc } from "@/lib/ports/types"
import { evaluateRulesHybrid } from "../hybrid-evaluator"

let container: Container

const ORG = "org-test"
const REPO = "repo-test"

function makeRule(id: string, overrides: Partial<RuleDoc> = {}): RuleDoc {
  return {
    id,
    org_id: ORG,
    repo_id: REPO,
    name: `rule-${id}`,
    title: `Rule ${id}`,
    description: `Description for ${id}`,
    type: "architecture",
    scope: "repo",
    enforcement: "warn",
    priority: 50,
    status: "active",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  }
}

function makeEntity(id: string, name: string, startLine = 10): EntityDoc {
  return {
    id,
    org_id: ORG,
    repo_id: REPO,
    kind: "function",
    name,
    file_path: "src/service.ts",
    start_line: startLine,
  }
}

beforeEach(() => {
  container = createTestContainer()
})

describe("evaluateRulesHybrid", () => {
  it("returns empty violations when no patterns match", async () => {
    const rules = [
      makeRule("r1", {
        semgrepRule: `rules:\n  - id: test\n    pattern: console.log(...)\n    message: no console\n    severity: WARNING\n    languages: [typescript]`,
      }),
    ]

    // FakePatternEngine.matchRule returns [] by default
    const result = await evaluateRulesHybrid(container, ORG, REPO, rules, "const x = 1")

    expect(result.violations).toEqual([])
    expect(result.rulesEvaluated).toBe(1)
    expect(result.syntacticMatches).toBe(0)
    expect(result.semanticEnrichments).toBe(0)
  })

  it("returns violations with enrichment from graph store", async () => {
    // Seed entity and justification for enrichment
    const entity = makeEntity("e1", "processOrder", 5)
    await container.graphStore.bulkUpsertEntities(ORG, [entity])
    await container.graphStore.bulkUpsertJustifications(ORG, [
      {
        id: "j-e1",
        org_id: ORG,
        repo_id: REPO,
        entity_id: "e1",
        taxonomy: "VERTICAL",
        confidence: 0.9,
        business_purpose: "Handles order processing",
        domain_concepts: ["order"],
        feature_tag: "order_management",
        semantic_triples: [],
        compliance_tags: [],
        model_tier: "standard",
        valid_from: "2026-01-01",
        valid_to: null,
        created_at: "2026-01-01",
      },
    ])

    // Override matchRule to return a violation near the entity
    const originalMatchRule = container.patternEngine.matchRule.bind(container.patternEngine)
    container.patternEngine.matchRule = async () => {
      return [
        {
          ruleId: "test-rule",
          file: "src/service.ts",
          line: 7,
          message: "Violation found",
          severity: "warning" as const,
          fix: "Remove it",
        },
      ]
    }

    const rules = [
      makeRule("r1", {
        semgrepRule: `rules:\n  - id: test-rule\n    pattern: bad_pattern\n    message: Violation found\n    severity: WARNING\n    languages: [typescript]`,
      }),
    ]

    const result = await evaluateRulesHybrid(
      container,
      ORG,
      REPO,
      rules,
      "bad_pattern()",
      "src/service.ts"
    )

    expect(result.violations).toHaveLength(1)
    expect(result.syntacticMatches).toBe(1)
    expect(result.violations[0]!.ruleId).toBe("r1")
    expect(result.violations[0]!.enforcement).toBe("warn")
    expect(result.violations[0]!.severity).toBe("warning")
    // Semantic enrichment: entity at line 5, violation at line 7 => abs(5-7)=2 < 10
    expect(result.semanticEnrichments).toBe(1)
    expect(result.violations[0]!.justification).toBe("Handles order processing")
    expect(result.violations[0]!.businessContext).toBe("order_management")

    // Restore
    container.patternEngine.matchRule = originalMatchRule
  })

  it("skips rules without semgrepRule", async () => {
    const rules = [
      makeRule("r1"), // no semgrepRule
      makeRule("r2"), // no semgrepRule
    ]

    const result = await evaluateRulesHybrid(container, ORG, REPO, rules, "const x = 1")

    expect(result.violations).toEqual([])
    expect(result.rulesEvaluated).toBe(2)
    expect(result.syntacticMatches).toBe(0)
  })

  it("maps enforcement to severity correctly", async () => {
    container.patternEngine.matchRule = async () => [
      { ruleId: "r", file: "f.ts", line: 1, message: "m", severity: "error" as const },
    ]

    const blockRule = makeRule("r-block", {
      enforcement: "block",
      semgrepRule: `rules:\n  - id: r\n    pattern: x\n    message: m\n    severity: ERROR\n    languages: [typescript]`,
    })
    const suggestRule = makeRule("r-suggest", {
      enforcement: "suggest",
      semgrepRule: `rules:\n  - id: r\n    pattern: x\n    message: m\n    severity: INFO\n    languages: [typescript]`,
    })

    const blockResult = await evaluateRulesHybrid(container, ORG, REPO, [blockRule], "x")
    expect(blockResult.violations[0]!.severity).toBe("error")

    const suggestResult = await evaluateRulesHybrid(container, ORG, REPO, [suggestRule], "x")
    expect(suggestResult.violations[0]!.severity).toBe("info")
  })
})
