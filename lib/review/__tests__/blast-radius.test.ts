import { beforeEach, describe, expect, it } from "vitest"
import { createTestContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"
import type { EntityDoc } from "@/lib/ports/types"
import { buildBlastRadiusSummary } from "@/lib/review/blast-radius"

const ORG_ID = "org-blast"
const REPO_ID = "repo-blast"

function makeEntity(id: string, kind: string, name: string, filePath: string): EntityDoc {
  return {
    id,
    org_id: ORG_ID,
    repo_id: REPO_ID,
    kind,
    name,
    file_path: filePath,
    start_line: 1,
    end_line: 20,
  }
}

describe("buildBlastRadiusSummary", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
  })

  it("returns an empty array when no affected entities are provided", async () => {
    const result = await buildBlastRadiusSummary(ORG_ID, [], container.graphStore)
    expect(result).toHaveLength(0)
  })

  it("returns empty array when affected entities are not functions or methods", async () => {
    // Only files and classes — filtered out by kind check
    const affected: EntityDoc[] = [
      makeEntity("file-1", "file", "index.ts", "src/index.ts"),
      makeEntity("class-1", "class", "UserService", "src/user.ts"),
    ]

    await container.graphStore.upsertEntity(ORG_ID, affected[0]!)
    await container.graphStore.upsertEntity(ORG_ID, affected[1]!)

    const result = await buildBlastRadiusSummary(ORG_ID, affected, container.graphStore)
    expect(result).toHaveLength(0)
  })

  it("returns empty array when a function has no boundary nodes in its subgraph", async () => {
    const fn1 = makeEntity("fn-util", "function", "formatDate", "src/utils.ts")
    await container.graphStore.upsertEntity(ORG_ID, fn1)

    const result = await buildBlastRadiusSummary(ORG_ID, [fn1], container.graphStore)
    expect(result).toHaveLength(0)
  })

  it("identifies api_route as an upstream boundary", async () => {
    // Graph: formatDate → [calls] → apiRoute
    const fn1 = makeEntity("fn-format", "function", "formatDate", "src/utils.ts")
    const apiRoute = makeEntity("route-users", "api_route", "GET /api/users", "src/api/users.ts")

    await container.graphStore.upsertEntity(ORG_ID, fn1)
    await container.graphStore.upsertEntity(ORG_ID, apiRoute)

    // Edge: fn-format calls route-users (direct edge)
    await container.graphStore.upsertEdge(ORG_ID, {
      _from: `functions/${fn1.id}`,
      _to: `api_routes/${apiRoute.id}`,
      kind: "calls",
      org_id: ORG_ID,
      repo_id: REPO_ID,
    })

    const result = await buildBlastRadiusSummary(ORG_ID, [fn1], container.graphStore)

    expect(result).toHaveLength(1)
    expect(result[0]?.entity).toBe("formatDate")
    expect(result[0]?.upstreamBoundaries).toHaveLength(1)
    expect(result[0]?.upstreamBoundaries[0]?.kind).toBe("api_route")
    expect(result[0]?.upstreamBoundaries[0]?.name).toBe("GET /api/users")
  })

  it("identifies component as an upstream boundary", async () => {
    const fn1 = makeEntity("fn-calc", "function", "calcTotal", "src/cart.ts")
    const component = makeEntity("comp-cart", "component", "CartSummary", "src/components/CartSummary.tsx")

    await container.graphStore.upsertEntity(ORG_ID, fn1)
    await container.graphStore.upsertEntity(ORG_ID, component)

    await container.graphStore.upsertEdge(ORG_ID, {
      _from: `functions/${fn1.id}`,
      _to: `components/${component.id}`,
      kind: "calls",
      org_id: ORG_ID,
      repo_id: REPO_ID,
    })

    const result = await buildBlastRadiusSummary(ORG_ID, [fn1], container.graphStore)

    expect(result).toHaveLength(1)
    expect(result[0]?.upstreamBoundaries[0]?.kind).toBe("component")
    expect(result[0]?.upstreamBoundaries[0]?.name).toBe("CartSummary")
  })

  it("includes callerCount in the summary", async () => {
    const fn1 = makeEntity("fn-process", "function", "processPayment", "src/payment.ts")
    const apiRoute = makeEntity("route-pay", "api_route", "POST /api/pay", "src/api/pay.ts")
    const caller1 = makeEntity("fn-caller-a", "function", "checkoutFlow", "src/checkout.ts")
    const caller2 = makeEntity("fn-caller-b", "function", "retryPayment", "src/retry.ts")

    await container.graphStore.upsertEntity(ORG_ID, fn1)
    await container.graphStore.upsertEntity(ORG_ID, apiRoute)
    await container.graphStore.upsertEntity(ORG_ID, caller1)
    await container.graphStore.upsertEntity(ORG_ID, caller2)

    // Connect fn1 to api boundary
    await container.graphStore.upsertEdge(ORG_ID, {
      _from: `functions/${fn1.id}`,
      _to: `api_routes/${apiRoute.id}`,
      kind: "calls",
      org_id: ORG_ID,
      repo_id: REPO_ID,
    })

    // Two callers of fn1
    await container.graphStore.upsertEdge(ORG_ID, {
      _from: `functions/${caller1.id}`,
      _to: `functions/${fn1.id}`,
      kind: "calls",
      org_id: ORG_ID,
      repo_id: REPO_ID,
    })
    await container.graphStore.upsertEdge(ORG_ID, {
      _from: `functions/${caller2.id}`,
      _to: `functions/${fn1.id}`,
      kind: "calls",
      org_id: ORG_ID,
      repo_id: REPO_ID,
    })

    const result = await buildBlastRadiusSummary(ORG_ID, [fn1], container.graphStore)

    expect(result).toHaveLength(1)
    expect(result[0]?.callerCount).toBe(2)
  })

  it("handles method kind in addition to function", async () => {
    const method = makeEntity("method-save", "method", "save", "src/models/User.ts")
    const apiRoute = makeEntity("route-save", "api_route", "PUT /api/users", "src/api/users.ts")

    await container.graphStore.upsertEntity(ORG_ID, method)
    await container.graphStore.upsertEntity(ORG_ID, apiRoute)

    await container.graphStore.upsertEdge(ORG_ID, {
      _from: `methods/${method.id}`,
      _to: `api_routes/${apiRoute.id}`,
      kind: "calls",
      org_id: ORG_ID,
      repo_id: REPO_ID,
    })

    const result = await buildBlastRadiusSummary(ORG_ID, [method], container.graphStore)

    expect(result).toHaveLength(1)
    expect(result[0]?.entity).toBe("save")
  })

  it("caps upstream boundaries at 5 per entity", async () => {
    const fn1 = makeEntity("fn-hub", "function", "coreLogic", "src/core.ts")
    await container.graphStore.upsertEntity(ORG_ID, fn1)

    // Create 7 api_route boundary nodes
    for (let i = 0; i < 7; i++) {
      const route = makeEntity(`route-${i}`, "api_route", `GET /api/route${i}`, `src/api/route${i}.ts`)
      await container.graphStore.upsertEntity(ORG_ID, route)
      await container.graphStore.upsertEdge(ORG_ID, {
        _from: `functions/${fn1.id}`,
        _to: `api_routes/${route.id}`,
        kind: "calls",
        org_id: ORG_ID,
        repo_id: REPO_ID,
      })
    }

    const result = await buildBlastRadiusSummary(ORG_ID, [fn1], container.graphStore)

    expect(result).toHaveLength(1)
    expect(result[0]?.upstreamBoundaries.length).toBeLessThanOrEqual(5)
  })

  it("propagation path string is present in upstream boundaries", async () => {
    const fn1 = makeEntity("fn-log", "function", "logEvent", "src/logger.ts")
    const apiRoute = makeEntity("route-log", "api_route", "POST /api/log", "src/api/log.ts")

    await container.graphStore.upsertEntity(ORG_ID, fn1)
    await container.graphStore.upsertEntity(ORG_ID, apiRoute)
    await container.graphStore.upsertEdge(ORG_ID, {
      _from: `functions/${fn1.id}`,
      _to: `api_routes/${apiRoute.id}`,
      kind: "calls",
      org_id: ORG_ID,
      repo_id: REPO_ID,
    })

    const result = await buildBlastRadiusSummary(ORG_ID, [fn1], container.graphStore)

    expect(result[0]?.upstreamBoundaries[0]?.path).toContain("logEvent")
    expect(result[0]?.upstreamBoundaries[0]?.path).toContain("POST /api/log")
  })
})
