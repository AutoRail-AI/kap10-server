import { beforeEach, describe, expect, it } from "vitest"
import { type Container, createTestContainer } from "@/lib/di/container"
import type { EntityDoc, JustificationDoc } from "@/lib/ports/types"
import type { McpAuthContext } from "../../auth"
import { handleAnalyzeImpact, handleGetBlueprint, handleGetBusinessContext, handleSearchByPurpose } from "../business"

let container: Container
let ctx: McpAuthContext

const ORG = "org-test"
const REPO = "repo-test"

function makeEntity(id: string, name: string, kind = "function"): EntityDoc {
  return { id, org_id: ORG, repo_id: REPO, kind, name, file_path: "src/test.ts", start_line: 10 }
}

function makeJustification(entityId: string): JustificationDoc {
  return {
    id: `j-${entityId}`, org_id: ORG, repo_id: REPO, entity_id: entityId,
    taxonomy: "VERTICAL", confidence: 0.9, business_purpose: "Handles orders",
    domain_concepts: ["order"], feature_tag: "order_management",
    semantic_triples: [{ subject: "OrderService", predicate: "manages", object: "orders" }],
    compliance_tags: [], model_tier: "standard",
    valid_from: "2026-01-01", valid_to: null, created_at: "2026-01-01",
  }
}

beforeEach(async () => {
  container = createTestContainer()
  ctx = { orgId: ORG, repoId: REPO, scopes: ["mcp:read"], keyId: "k-1" }

  // Seed entities and justifications
  const entity = makeEntity("e1", "processOrder")
  await container.graphStore.bulkUpsertEntities(ORG, [entity])
  await container.graphStore.bulkUpsertJustifications(ORG, [makeJustification("e1")])
})

describe("handleGetBusinessContext", () => {
  it("returns justification for found entity", async () => {
    const result = await handleGetBusinessContext(
      { entity_name: "processOrder" },
      ctx,
      container
    )
    const text = result.content[0]!.text
    const parsed = JSON.parse(text) as { justification: { taxonomy: string } }
    expect(parsed.justification.taxonomy).toBe("VERTICAL")
  })

  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleGetBusinessContext(
      { entity_name: "processOrder" },
      noRepoCtx as McpAuthContext,
      container
    )
    expect(result.isError).toBe(true)
  })

  it("returns null justification for entity without one", async () => {
    await container.graphStore.bulkUpsertEntities(ORG, [makeEntity("e2", "helperFunc")])
    const result = await handleGetBusinessContext(
      { entity_name: "helperFunc" },
      ctx,
      container
    )
    const text = result.content[0]!.text
    const parsed = JSON.parse(text) as { justification: null }
    expect(parsed.justification).toBeNull()
  })
})

describe("handleSearchByPurpose", () => {
  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleSearchByPurpose(
      { query: "order processing" },
      noRepoCtx as McpAuthContext,
      container
    )
    expect(result.isError).toBe(true)
  })

  it("returns results for valid query", async () => {
    const result = await handleSearchByPurpose(
      { query: "order processing" },
      ctx,
      container
    )
    expect(result.isError).toBeUndefined()
  })
})

describe("handleAnalyzeImpact", () => {
  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleAnalyzeImpact(
      { entity_name: "processOrder" },
      noRepoCtx as McpAuthContext,
      container
    )
    expect(result.isError).toBe(true)
  })
})

describe("handleGetBlueprint", () => {
  it("returns blueprint data", async () => {
    const result = await handleGetBlueprint({}, ctx, container)
    const text = result.content[0]!.text
    const parsed = JSON.parse(text) as { features: unknown[] }
    expect(parsed.features).toBeDefined()
  })

  it("returns error without repo context", async () => {
    const noRepoCtx = { ...ctx, repoId: undefined }
    const result = await handleGetBlueprint({}, noRepoCtx as McpAuthContext, container)
    expect(result.isError).toBe(true)
  })
})
