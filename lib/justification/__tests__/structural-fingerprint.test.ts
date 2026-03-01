import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import { describe, expect, it } from "vitest"
import {
  buildFingerprintFromEntity,
  computeStructuralFingerprints,
  fingerprintToTokens,
} from "../structural-fingerprint"

function makeEntity(
  id: string,
  name: string,
  filePath: string,
  extra?: Record<string, unknown>
): EntityDoc {
  return {
    id,
    org_id: "org1",
    repo_id: "repo1",
    name,
    kind: "function",
    file_path: filePath,
    start_line: 1,
    ...extra,
  } as EntityDoc
}

function makeEdge(from: string, to: string, kind = "calls"): EdgeDoc {
  return {
    _from: `functions/${from}`,
    _to: `functions/${to}`,
    kind,
    org_id: "org1",
    repo_id: "repo1",
  } as EdgeDoc
}

describe("computeStructuralFingerprints", () => {
  it("computes correct BFS depth for a 3-node chain", () => {
    // entry → A → B
    const entry = makeEntity("entry", "handler", "src/app/route.ts")
    const a = makeEntity("a", "processOrder", "src/order.ts")
    const b = makeEntity("b", "saveOrder", "src/db.ts")

    const edges = [
      makeEdge("entry", "a"),
      makeEdge("a", "b"),
    ]

    const fps = computeStructuralFingerprints([entry, a, b], edges)

    expect(fps.get("entry")!.depth_from_entry).toBe(0)
    expect(fps.get("a")!.depth_from_entry).toBe(1)
    expect(fps.get("b")!.depth_from_entry).toBe(2)
  })

  it("gives disconnected entities depth 99", () => {
    const entry = makeEntity("entry", "handler", "src/app/route.ts")
    const disconnected = makeEntity("orphan", "unusedFn", "src/util.ts")

    const fps = computeStructuralFingerprints([entry, disconnected], [])

    expect(fps.get("entry")!.depth_from_entry).toBe(0) // entry point itself
    expect(fps.get("orphan")!.depth_from_entry).toBe(99)
  })

  it("computes fan_ratio as fan_out / (fan_in + 1)", () => {
    const entity = makeEntity("a", "orchestrate", "src/service.ts", {
      fan_in: 2,
      fan_out: 8,
    })

    const fps = computeStructuralFingerprints([entity], [])
    // fan_ratio = 8 / (2 + 1) = 2.67
    expect(fps.get("a")!.fan_ratio).toBeCloseTo(2.67, 1)
  })

  it("handles zero fan_in gracefully (no division by zero)", () => {
    const entity = makeEntity("a", "leafFn", "src/leaf.ts", {
      fan_in: 0,
      fan_out: 3,
    })

    const fps = computeStructuralFingerprints([entity], [])
    // fan_ratio = 3 / (0 + 1) = 3
    expect(fps.get("a")!.fan_ratio).toBe(3)
  })

  it("detects boundary nodes (importing external packages)", () => {
    const internal = makeEntity("a", "useStripe", "src/payment.ts")
    const externalTarget = "external-pkg-id" // not in entity set

    const edges: EdgeDoc[] = [
      makeEdge("a", externalTarget, "imports"),
    ]

    const fps = computeStructuralFingerprints([internal], edges)
    expect(fps.get("a")!.is_boundary).toBe(true)
  })

  it("does not mark entity as boundary for internal imports", () => {
    const a = makeEntity("a", "serviceA", "src/a.ts")
    const b = makeEntity("b", "serviceB", "src/b.ts")

    const edges: EdgeDoc[] = [
      makeEdge("a", "b", "imports"),
    ]

    const fps = computeStructuralFingerprints([a, b], edges)
    expect(fps.get("a")!.is_boundary).toBe(false)
  })

  it("reads pagerank_percentile and community_id from entity metadata", () => {
    const entity = makeEntity("a", "fn", "src/a.ts", {
      pagerank_percentile: 85,
      community_id: 3,
    })

    const fps = computeStructuralFingerprints([entity], [])
    expect(fps.get("a")!.pagerank_percentile).toBe(85)
    expect(fps.get("a")!.community_id).toBe(3)
  })

  it("defaults pagerank_percentile to 0 and community_id to -1 when missing", () => {
    const entity = makeEntity("a", "fn", "src/a.ts")

    const fps = computeStructuralFingerprints([entity], [])
    expect(fps.get("a")!.pagerank_percentile).toBe(0)
    expect(fps.get("a")!.community_id).toBe(-1)
  })
})

describe("buildFingerprintFromEntity", () => {
  it("returns null if pagerank_percentile is not set", () => {
    const entity = makeEntity("a", "fn", "src/a.ts")
    expect(buildFingerprintFromEntity(entity)).toBeNull()
  })

  it("builds fingerprint from pre-computed entity metadata", () => {
    const entity = makeEntity("a", "fn", "src/a.ts", {
      pagerank_percentile: 72,
      community_id: 5,
      depth_from_entry: 3,
      fan_ratio: 1.5,
      is_boundary: true,
    })

    const fp = buildFingerprintFromEntity(entity)
    expect(fp).toEqual({
      pagerank_percentile: 72,
      community_id: 5,
      depth_from_entry: 3,
      fan_ratio: 1.5,
      is_boundary: true,
    })
  })
})

describe("fingerprintToTokens", () => {
  it("returns correct centrality bucket for critical (P95+)", () => {
    const tokens = fingerprintToTokens({
      pagerank_percentile: 97,
      community_id: 2,
      depth_from_entry: 1,
      fan_ratio: 3.5,
      is_boundary: true,
    })

    expect(tokens).toContain("Centrality: critical (P97)")
    expect(tokens).toContain("Role: orchestrator")
    expect(tokens).toContain("Boundary: yes")
    expect(tokens).toContain("Community: 2")
    expect(tokens).toContain("Depth: 1 hops from entry")
  })

  it("returns correct centrality bucket for high (P75-95)", () => {
    const tokens = fingerprintToTokens({
      pagerank_percentile: 80,
      community_id: -1,
      depth_from_entry: 2,
      fan_ratio: 1.0,
      is_boundary: false,
    })

    expect(tokens).toContain("Centrality: high (P80)")
    expect(tokens).toContain("Role: connector")
    expect(tokens).toContain("Boundary: no")
    expect(tokens).not.toContain("Community:")
  })

  it("returns correct centrality bucket for low (P0-25)", () => {
    const tokens = fingerprintToTokens({
      pagerank_percentile: 10,
      community_id: 0,
      depth_from_entry: 99,
      fan_ratio: 0.2,
      is_boundary: false,
    })

    expect(tokens).toContain("Centrality: low (P10)")
    expect(tokens).toContain("Role: leaf/utility")
    expect(tokens).toContain("Depth: disconnected")
  })

  it("shows 'medium' centrality for P25-75", () => {
    const tokens = fingerprintToTokens({
      pagerank_percentile: 50,
      community_id: 1,
      depth_from_entry: 0,
      fan_ratio: 0.8,
      is_boundary: false,
    })

    expect(tokens).toContain("Centrality: medium (P50)")
    expect(tokens).toContain("Depth: 0 hops from entry")
  })
})
