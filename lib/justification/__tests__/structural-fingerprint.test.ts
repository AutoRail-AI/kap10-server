import { describe, expect, it } from "vitest"
import type { EntityDoc } from "@/lib/ports/types"
import {
  buildFingerprintFromEntity,
  DISCONNECTED_DEPTH,
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

  it("handles pagerank_percentile of 0 (falsy but valid)", () => {
    const entity = makeEntity("b", "fn2", "src/b.ts", {
      pagerank_percentile: 0,
      community_id: 1,
    })
    const fp = buildFingerprintFromEntity(entity)
    expect(fp).not.toBeNull()
    expect(fp!.pagerank_percentile).toBe(0)
  })

  it("uses defaults for missing optional fields", () => {
    const entity = makeEntity("c", "fn3", "src/c.ts", {
      pagerank_percentile: 50,
    })
    const fp = buildFingerprintFromEntity(entity)
    expect(fp).toEqual({
      pagerank_percentile: 50,
      community_id: -1,
      depth_from_entry: DISCONNECTED_DEPTH,
      fan_ratio: 0,
      is_boundary: false,
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
      depth_from_entry: DISCONNECTED_DEPTH,
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

  it("boundary values: exactly P25 → medium, P75 → high, P95 → critical", () => {
    const at25 = fingerprintToTokens({ pagerank_percentile: 25, community_id: -1, depth_from_entry: 0, fan_ratio: 0, is_boundary: false })
    expect(at25).toContain("Centrality: medium")

    const at75 = fingerprintToTokens({ pagerank_percentile: 75, community_id: -1, depth_from_entry: 0, fan_ratio: 0, is_boundary: false })
    expect(at75).toContain("Centrality: high")

    const at95 = fingerprintToTokens({ pagerank_percentile: 95, community_id: -1, depth_from_entry: 0, fan_ratio: 0, is_boundary: false })
    expect(at95).toContain("Centrality: critical")
  })

  it("fan_ratio boundary: 0.5 → connector, 2.0 → connector, >2.0 → orchestrator", () => {
    const conn = fingerprintToTokens({ pagerank_percentile: 50, community_id: -1, depth_from_entry: 0, fan_ratio: 0.5, is_boundary: false })
    expect(conn).toContain("Role: connector")

    const conn2 = fingerprintToTokens({ pagerank_percentile: 50, community_id: -1, depth_from_entry: 0, fan_ratio: 2.0, is_boundary: false })
    expect(conn2).toContain("Role: connector")

    const orch = fingerprintToTokens({ pagerank_percentile: 50, community_id: -1, depth_from_entry: 0, fan_ratio: 2.1, is_boundary: false })
    expect(orch).toContain("Role: orchestrator")
  })
})
