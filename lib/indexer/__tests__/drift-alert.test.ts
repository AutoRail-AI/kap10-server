/**
 * P5-TEST-01e: Semantic drift alerting.
 * Tests the driftEvaluationActivity from lib/temporal/activities/drift-alert.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Container } from "@/lib/di/container"
import { createTestContainer } from "@/lib/di/container"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"

vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
}))

vi.mock("@/lib/di/container", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/di/container")>()
  let testContainer: Container | null = null
  return {
    ...original,
    getContainer: () => testContainer ?? original.createTestContainer(),
    __setTestContainer: (c: Container) => {
      testContainer = c
    },
    __resetTestContainer: () => {
      testContainer = null
    },
  }
})

// Import after mocks
const { __setTestContainer, __resetTestContainer } = await import("@/lib/di/container")
const { driftEvaluationActivity } = await import("@/lib/temporal/activities/drift-alert")

function makeEntity(overrides: Partial<EntityDoc> & { id: string; name: string }): EntityDoc {
  return {
    kind: "function",
    file_path: "src/service.ts",
    start_line: 1,
    end_line: 20,
    org_id: "org-1",
    repo_id: "repo-1",
    ...overrides,
  } as EntityDoc
}

function makeJustification(overrides: Partial<JustificationDoc> & { id: string; entity_id: string }): JustificationDoc {
  return {
    org_id: "org-1",
    repo_id: "repo-1",
    taxonomy: "VERTICAL",
    confidence: 0.9,
    business_purpose: "Handles user authentication",
    domain_concepts: [],
    feature_tag: "auth",
    semantic_triples: [],
    compliance_tags: [],
    model_tier: "fast",
    model_used: "gpt-4o-mini",
    valid_from: new Date().toISOString(),
    valid_to: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe("driftEvaluationActivity", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
    __setTestContainer(container)
    // Enable drift alerting and set low threshold for testing
    process.env.DRIFT_ALERT_ENABLED = "true"
    process.env.DRIFT_ALERT_CALLER_THRESHOLD = "2"
    process.env.DRIFT_ALERT_CHANNEL = "dashboard"
  })

  afterEach(() => {
    __resetTestContainer()
    delete process.env.DRIFT_ALERT_ENABLED
    delete process.env.DRIFT_ALERT_CALLER_THRESHOLD
    delete process.env.DRIFT_ALERT_CHANNEL
  })

  it("returns isDrift=false when entity does not exist", async () => {
    const result = await driftEvaluationActivity({
      orgId: "org-1",
      repoId: "repo-1",
      entityKey: "nonexistent-entity",
    })
    expect(result.isDrift).toBe(false)
    expect(result.alert).toBeUndefined()
  })

  it("returns isDrift=false when there is no previous justification", async () => {
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-1", name: "processPayment" }))

    const result = await driftEvaluationActivity({
      orgId: "org-1",
      repoId: "repo-1",
      entityKey: "fn-1",
    })
    expect(result.isDrift).toBe(false)
  })

  it("returns isDrift=false when entity has not changed purpose (same justification)", async () => {
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-1", name: "processPayment" }))

    // Insert a single justification — old and new are the same
    const justification = makeJustification({
      id: "j-1",
      entity_id: "fn-1",
      business_purpose: "Processes credit card payments",
    })
    await container.graphStore.bulkUpsertJustifications("org-1", [justification])

    const result = await driftEvaluationActivity({
      orgId: "org-1",
      repoId: "repo-1",
      entityKey: "fn-1",
    })
    expect(result.isDrift).toBe(false)
  })

  it("triggers alert when LLM detects drift and caller threshold is met", async () => {
    // Set up entity
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-target", name: "handleRequest" }))

    // Set up callers (2 callers meets threshold of 2)
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-caller-1", name: "apiRouter", file_path: "src/router.ts", start_line: 5 }))
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-caller-2", name: "webhookHandler", file_path: "src/webhook.ts", start_line: 10 }))
    await container.graphStore.upsertEdge("org-1", { _from: "functions/fn-caller-1", _to: "functions/fn-target", kind: "calls", org_id: "org-1", repo_id: "repo-1" })
    await container.graphStore.upsertEdge("org-1", { _from: "functions/fn-caller-2", _to: "functions/fn-target", kind: "calls", org_id: "org-1", repo_id: "repo-1" })

    // The activity's logic:
    //   oldJustification = getJustification() -> returns the active one (valid_to === null)
    //   newJustification = history[0] -> returns the most recent by valid_from
    // For drift detection, we need history[0].id !== getJustification().id.
    //
    // Insert order matters: insert j-new first (with valid_to set, so it's closed),
    // then j-old (with valid_to === null, so it's the active one).
    // history[0] will be j-new (later valid_from) while getJustification returns j-old.

    // New justification first: closed (valid_to set), later valid_from
    const newJust = makeJustification({
      id: "j-new",
      entity_id: "fn-target",
      business_purpose: "Processes background job queue messages",
      valid_from: "2025-02-01T00:00:00Z",
      valid_to: "2025-02-01T00:00:01Z",
    })
    await container.graphStore.bulkUpsertJustifications("org-1", [newJust])

    // Old justification: active (valid_to === null), earlier valid_from
    const oldJust = makeJustification({
      id: "j-old",
      entity_id: "fn-target",
      business_purpose: "Handles incoming HTTP requests for the REST API",
      valid_from: "2025-01-01T00:00:00Z",
    })
    await container.graphStore.bulkUpsertJustifications("org-1", [oldJust])

    // Override MockLLMProvider to return isDrift=true
    container.llmProvider.generateObject = async () => ({
      object: { isDrift: true, explanation: "Purpose fundamentally changed from HTTP to message queue" },
      usage: { inputTokens: 100, outputTokens: 50 },
    })

    const result = await driftEvaluationActivity({
      orgId: "org-1",
      repoId: "repo-1",
      entityKey: "fn-target",
    })

    expect(result.isDrift).toBe(true)
    expect(result.alert).toBeDefined()
    expect(result.alert!.entityName).toBe("handleRequest")
    expect(result.alert!.oldPurpose).toContain("HTTP requests")
    expect(result.alert!.newPurpose).toContain("background job")
    expect(result.alert!.affectedCallers.length).toBe(2)
    expect(result.alert!.affectedCallers.map((c) => c.name)).toContain("apiRouter")
    expect(result.alert!.affectedCallers.map((c) => c.name)).toContain("webhookHandler")
    expect(result.alert!.channel).toBe("dashboard")
  })

  it("returns isDrift=false when LLM says no drift even with multiple justifications", async () => {
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-1", name: "validate" }))

    // Insert closed justification first (later valid_from), then active one
    const newJust = makeJustification({
      id: "j-new",
      entity_id: "fn-1",
      business_purpose: "Validates and sanitizes user input",
      valid_from: "2025-02-01T00:00:00Z",
      valid_to: "2025-02-01T00:00:01Z",
    })
    await container.graphStore.bulkUpsertJustifications("org-1", [newJust])

    const oldJust = makeJustification({
      id: "j-old",
      entity_id: "fn-1",
      business_purpose: "Validates user input",
      valid_from: "2025-01-01T00:00:00Z",
    })
    await container.graphStore.bulkUpsertJustifications("org-1", [oldJust])

    // LLM says no drift — just a refinement
    container.llmProvider.generateObject = async () => ({
      object: { isDrift: false, explanation: "Only a refinement, same core purpose" },
      usage: { inputTokens: 100, outputTokens: 50 },
    })

    const result = await driftEvaluationActivity({
      orgId: "org-1",
      repoId: "repo-1",
      entityKey: "fn-1",
    })
    expect(result.isDrift).toBe(false)
  })

  it("returns isDrift=false when caller count is below threshold", async () => {
    process.env.DRIFT_ALERT_CALLER_THRESHOLD = "10"

    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-1", name: "helper" }))

    // Only 1 caller — below threshold of 10
    await container.graphStore.upsertEntity("org-1", makeEntity({ id: "fn-c1", name: "main" }))
    await container.graphStore.upsertEdge("org-1", { _from: "functions/fn-c1", _to: "functions/fn-1", kind: "calls", org_id: "org-1", repo_id: "repo-1" })

    // Insert closed justification (later valid_from) first, then active one
    const newJust = makeJustification({
      id: "j-new",
      entity_id: "fn-1",
      business_purpose: "Completely new purpose",
      valid_from: "2025-02-01T00:00:00Z",
      valid_to: "2025-02-01T00:00:01Z",
    })
    await container.graphStore.bulkUpsertJustifications("org-1", [newJust])

    const oldJust = makeJustification({
      id: "j-old",
      entity_id: "fn-1",
      business_purpose: "Old purpose",
      valid_from: "2025-01-01T00:00:00Z",
    })
    await container.graphStore.bulkUpsertJustifications("org-1", [oldJust])

    container.llmProvider.generateObject = async () => ({
      object: { isDrift: true, explanation: "Major change" },
      usage: { inputTokens: 100, outputTokens: 50 },
    })

    const result = await driftEvaluationActivity({
      orgId: "org-1",
      repoId: "repo-1",
      entityKey: "fn-1",
    })
    expect(result.isDrift).toBe(false)
  })

  it("returns isDrift=false when drift alerting is disabled", async () => {
    process.env.DRIFT_ALERT_ENABLED = "false"

    const result = await driftEvaluationActivity({
      orgId: "org-1",
      repoId: "repo-1",
      entityKey: "fn-1",
    })
    expect(result.isDrift).toBe(false)
  })
})
