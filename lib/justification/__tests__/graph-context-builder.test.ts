import { describe, it, expect } from "vitest"
import { computeApproxCentrality, summarizeSubgraph } from "../graph-context-builder"
import type { EntityDoc, EdgeDoc } from "@/lib/ports/types"

describe("computeApproxCentrality", () => {
  it("returns 0 for single entity", () => {
    const entities: EntityDoc[] = [
      { id: "e1", org_id: "o", repo_id: "r", kind: "function", name: "foo", file_path: "a.ts" },
    ]
    expect(computeApproxCentrality("e1", entities, [])).toBe(0)
  })

  it("computes centrality based on edge connections", () => {
    const entities: EntityDoc[] = [
      { id: "e1", org_id: "o", repo_id: "r", kind: "function", name: "foo", file_path: "a.ts" },
      { id: "e2", org_id: "o", repo_id: "r", kind: "function", name: "bar", file_path: "b.ts" },
      { id: "e3", org_id: "o", repo_id: "r", kind: "function", name: "baz", file_path: "c.ts" },
    ]
    const edges: EdgeDoc[] = [
      { _from: "functions/e2", _to: "functions/e1", kind: "calls", org_id: "o", repo_id: "r" },
      { _from: "functions/e3", _to: "functions/e1", kind: "calls", org_id: "o", repo_id: "r" },
    ]
    // e1 has 2 edges, max degree = (3-1)*2 = 4, centrality = 2/4 = 0.5
    expect(computeApproxCentrality("e1", entities, edges)).toBe(0.5)
  })

  it("returns 0 for entity with no edges", () => {
    const entities: EntityDoc[] = [
      { id: "e1", org_id: "o", repo_id: "r", kind: "function", name: "foo", file_path: "a.ts" },
      { id: "e2", org_id: "o", repo_id: "r", kind: "function", name: "bar", file_path: "b.ts" },
    ]
    expect(computeApproxCentrality("e1", entities, [])).toBe(0)
  })
})

describe("summarizeSubgraph", () => {
  const entity: EntityDoc = {
    id: "e1", org_id: "o", repo_id: "r", kind: "function", name: "processOrder", file_path: "orders.ts",
  }

  it("summarizes with callers and callees", () => {
    const neighbors = [
      { id: "e2", name: "validateOrder", kind: "function", direction: "inbound" },
      { id: "e3", name: "saveOrder", kind: "function", direction: "outbound" },
    ]
    const summary = summarizeSubgraph(entity, neighbors)
    expect(summary).toContain("processOrder")
    expect(summary).toContain("Called by: validateOrder")
    expect(summary).toContain("Calls: saveOrder")
  })

  it("handles isolated entity", () => {
    const summary = summarizeSubgraph(entity, [])
    expect(summary).toContain("Isolated entity")
  })
})
