import { beforeEach, describe, expect, it } from "vitest"
import { createTestContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"
import type { EntityDoc, JustificationDoc, ReviewConfig } from "@/lib/ports/types"
import { DEFAULT_REVIEW_CONFIG } from "@/lib/ports/types"
import type { ReviewComment } from "@/lib/review/comment-builder"
import { evaluateSemanticLgtm } from "@/lib/review/semantic-lgtm"

const ORG_ID = "org-lgtm"
const REPO_ID = "repo-lgtm"

function makeConfig(overrides?: Partial<ReviewConfig>): ReviewConfig {
  return {
    ...DEFAULT_REVIEW_CONFIG,
    semanticLgtmEnabled: true,
    lowRiskCallerThreshold: 5,
    horizontalAreas: ["utility", "infrastructure", "config", "docs", "test", "ci"],
    ...overrides,
  }
}

function makeEntity(id: string, name: string): EntityDoc {
  return {
    id,
    org_id: ORG_ID,
    repo_id: REPO_ID,
    kind: "function",
    name,
    file_path: `src/${name}.ts`,
    start_line: 1,
    end_line: 10,
  }
}

function makeJustification(entityId: string, taxonomy: "VERTICAL" | "HORIZONTAL" | "UTILITY", featureTag: string): JustificationDoc {
  return {
    id: `j-${entityId}`,
    org_id: ORG_ID,
    repo_id: REPO_ID,
    entity_id: entityId,
    taxonomy,
    confidence: 0.9,
    business_purpose: "test purpose",
    domain_concepts: [],
    feature_tag: featureTag,
    semantic_triples: [],
    compliance_tags: [],
    model_tier: "heuristic",
    valid_from: new Date().toISOString(),
    valid_to: null,
    created_at: new Date().toISOString(),
  }
}

function makeBlockerComment(): ReviewComment {
  return {
    path: "src/foo.ts",
    line: 5,
    body: "This is a blocker",
    checkType: "pattern",
    severity: "error",
  }
}

function makeWarningComment(): ReviewComment {
  return {
    path: "src/bar.ts",
    line: 10,
    body: "This is a warning",
    checkType: "pattern",
    severity: "warning",
  }
}

describe("evaluateSemanticLgtm", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
  })

  it("returns autoApprove=false when semanticLgtmEnabled is false", async () => {
    const config = makeConfig({ semanticLgtmEnabled: false })
    const entity = makeEntity("fn-1", "helperFn")
    await container.graphStore.upsertEntity(ORG_ID, entity)

    const result = await evaluateSemanticLgtm(ORG_ID, [entity], [], container.graphStore, config)

    expect(result.autoApprove).toBe(false)
    expect(result.reason).toContain("disabled")
  })

  it("returns autoApprove=false when there are blocking (error) comments", async () => {
    const config = makeConfig()
    const entity = makeEntity("fn-blocked", "blockedFn")
    await container.graphStore.upsertEntity(ORG_ID, entity)

    const result = await evaluateSemanticLgtm(
      ORG_ID,
      [entity],
      [makeBlockerComment()],
      container.graphStore,
      config
    )

    expect(result.autoApprove).toBe(false)
    expect(result.reason).toContain("Blocking violations")
  })

  it("does NOT auto-approve when entity has no justification (unknown risk)", async () => {
    const config = makeConfig()
    const entity = makeEntity("fn-no-just", "undocumentedFn")
    await container.graphStore.upsertEntity(ORG_ID, entity)
    // No justification upserted

    const result = await evaluateSemanticLgtm(
      ORG_ID,
      [entity],
      [],
      container.graphStore,
      config
    )

    expect(result.autoApprove).toBe(false)
    expect(result.reason).toContain("no justification")
  })

  it("does NOT auto-approve when entity taxonomy is VERTICAL", async () => {
    const config = makeConfig()
    const entity = makeEntity("fn-vertical", "checkoutFn")
    await container.graphStore.upsertEntity(ORG_ID, entity)
    await container.graphStore.bulkUpsertJustifications(ORG_ID, [
      makeJustification(entity.id, "VERTICAL", "payments"),
    ])

    const result = await evaluateSemanticLgtm(
      ORG_ID,
      [entity],
      [],
      container.graphStore,
      config
    )

    expect(result.autoApprove).toBe(false)
    expect(result.reason).toContain("VERTICAL")
  })

  it("does NOT auto-approve when entity is in a non-horizontal feature area", async () => {
    const config = makeConfig({ horizontalAreas: ["utility", "infrastructure"] })
    const entity = makeEntity("fn-billing", "processBillingFn")
    await container.graphStore.upsertEntity(ORG_ID, entity)
    await container.graphStore.bulkUpsertJustifications(ORG_ID, [
      makeJustification(entity.id, "HORIZONTAL", "billing"),
    ])

    const result = await evaluateSemanticLgtm(
      ORG_ID,
      [entity],
      [],
      container.graphStore,
      config
    )

    expect(result.autoApprove).toBe(false)
    expect(result.reason).toContain("non-horizontal area")
    expect(result.reason).toContain("billing")
  })

  it("does NOT auto-approve when entity has callers exceeding the threshold", async () => {
    const config = makeConfig({ lowRiskCallerThreshold: 3 })
    const entity = makeEntity("fn-hot", "hotPathFn")
    await container.graphStore.upsertEntity(ORG_ID, entity)
    await container.graphStore.bulkUpsertJustifications(ORG_ID, [
      makeJustification(entity.id, "HORIZONTAL", "utility"),
    ])

    // Add 4 callers (exceeds threshold of 3)
    for (let i = 0; i < 4; i++) {
      const caller = makeEntity(`fn-caller-${i}`, `caller${i}`)
      await container.graphStore.upsertEntity(ORG_ID, caller)
      await container.graphStore.upsertEdge(ORG_ID, {
        _from: `functions/${caller.id}`,
        _to: `functions/${entity.id}`,
        kind: "calls",
        org_id: ORG_ID,
        repo_id: REPO_ID,
      })
    }

    const result = await evaluateSemanticLgtm(
      ORG_ID,
      [entity],
      [],
      container.graphStore,
      config
    )

    expect(result.autoApprove).toBe(false)
    expect(result.reason).toContain("4 callers")
    expect(result.reason).toContain("threshold 3")
  })

  it("auto-approves when entity is horizontal utility with low callers and no blockers", async () => {
    const config = makeConfig({ lowRiskCallerThreshold: 5 })
    const entity = makeEntity("fn-util", "formatDate")
    await container.graphStore.upsertEntity(ORG_ID, entity)
    await container.graphStore.bulkUpsertJustifications(ORG_ID, [
      makeJustification(entity.id, "HORIZONTAL", "utility"),
    ])

    // Add 2 callers (below threshold of 5)
    for (let i = 0; i < 2; i++) {
      const caller = makeEntity(`fn-caller-ok-${i}`, `callerOk${i}`)
      await container.graphStore.upsertEntity(ORG_ID, caller)
      await container.graphStore.upsertEdge(ORG_ID, {
        _from: `functions/${caller.id}`,
        _to: `functions/${entity.id}`,
        kind: "calls",
        org_id: ORG_ID,
        repo_id: REPO_ID,
      })
    }

    const result = await evaluateSemanticLgtm(
      ORG_ID,
      [entity],
      [makeWarningComment()], // warnings are OK for semantic LGTM
      container.graphStore,
      config
    )

    expect(result.autoApprove).toBe(true)
    expect(result.reason).toContain("horizontal")
  })

  it("auto-approves UTILITY taxonomy entities with no callers", async () => {
    const config = makeConfig({ lowRiskCallerThreshold: 5 })
    const entity = makeEntity("fn-infra", "setupLogger")
    await container.graphStore.upsertEntity(ORG_ID, entity)
    await container.graphStore.bulkUpsertJustifications(ORG_ID, [
      makeJustification(entity.id, "UTILITY", "infrastructure"),
    ])

    const result = await evaluateSemanticLgtm(
      ORG_ID,
      [entity],
      [],
      container.graphStore,
      config
    )

    expect(result.autoApprove).toBe(true)
  })

  it("requires ALL entities to pass gates (fails on first failing entity)", async () => {
    const config = makeConfig()
    const entityGood = makeEntity("fn-good", "goodFn")
    const entityBad = makeEntity("fn-bad", "badFn")

    await container.graphStore.upsertEntity(ORG_ID, entityGood)
    await container.graphStore.upsertEntity(ORG_ID, entityBad)

    await container.graphStore.bulkUpsertJustifications(ORG_ID, [
      makeJustification(entityGood.id, "HORIZONTAL", "utility"),
      makeJustification(entityBad.id, "VERTICAL", "payments"),
    ])

    const result = await evaluateSemanticLgtm(
      ORG_ID,
      [entityGood, entityBad],
      [],
      container.graphStore,
      config
    )

    expect(result.autoApprove).toBe(false)
    expect(result.reason).toContain("VERTICAL")
  })

  it("uses DEFAULT_HORIZONTAL_AREAS when config.horizontalAreas is empty", async () => {
    const config = makeConfig({ horizontalAreas: [] })
    const entity = makeEntity("fn-ci", "runCi")
    await container.graphStore.upsertEntity(ORG_ID, entity)
    await container.graphStore.bulkUpsertJustifications(ORG_ID, [
      makeJustification(entity.id, "HORIZONTAL", "ci"),
    ])

    const result = await evaluateSemanticLgtm(
      ORG_ID,
      [entity],
      [],
      container.graphStore,
      config
    )

    // "ci" is in DEFAULT_HORIZONTAL_AREAS, so it should pass
    expect(result.autoApprove).toBe(true)
  })

  it("returns autoApprove=true for empty affected entities list (vacuously all pass)", async () => {
    const config = makeConfig()

    const result = await evaluateSemanticLgtm(ORG_ID, [], [], container.graphStore, config)

    expect(result.autoApprove).toBe(true)
  })
})
