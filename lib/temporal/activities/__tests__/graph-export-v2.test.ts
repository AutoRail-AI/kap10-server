/**
 * Phase 10b TEST-10: v2 graph export with rules and patterns.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock Temporal heartbeat
vi.mock("@temporalio/activity", () => ({
  heartbeat: vi.fn(),
}))

// Mock the DI container
vi.mock("@/lib/di/container", () => ({
  getContainer: vi.fn(),
}))

// Mock graph compactor
vi.mock("@/lib/use-cases/graph-compactor", () => ({
  compactEntity: vi.fn((e) => ({
    key: e.id,
    kind: e.kind,
    name: e.name,
    file_path: e.file_path,
  })),
  compactEdge: vi.fn((e) => ({
    from_key: e._from,
    to_key: e._to,
    type: e.kind,
  })),
}))

// Mock graph serializer
vi.mock("@/lib/use-cases/graph-serializer", () => ({
  serializeSnapshot: vi.fn().mockReturnValue(Buffer.from("test")),
  computeChecksum: vi.fn().mockReturnValue("abc123"),
}))

import { getContainer } from "@/lib/di/container"
import { serializeSnapshot } from "@/lib/use-cases/graph-serializer"
import { queryCompactGraph, serializeToMsgpack } from "../graph-export"

describe("queryCompactGraph v2 — rules + patterns export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const mockContainer = {
      graphStore: {
        getFilePaths: vi.fn().mockResolvedValue([{ path: "src/index.ts" }]),
        getEntitiesByFile: vi.fn().mockResolvedValue([
          { id: "fn1", kind: "function", name: "main", file_path: "src/index.ts" },
        ]),
        getCalleesOf: vi.fn().mockResolvedValue([]),
        queryRules: vi.fn().mockResolvedValue([
          {
            id: "rule-1",
            name: "no-console",
            title: "No console.log",
            description: "Avoid console.log in production",
            type: "security",
            scope: "repo",
            pathGlob: "**/*.ts",
            enforcement: "warn",
            status: "active",
            priority: 1,
            semgrepRule: null,
            astGrepQuery: "call_expression",
            repo_id: "repo-1",
            created_at: "2025-01-01",
            updated_at: "2025-01-01",
          },
        ]),
        queryPatterns: vi.fn().mockResolvedValue([
          {
            id: "pat-1",
            name: "error-boundary",
            title: "Error Boundary",
            type: "structural",
            confidence: 0.88,
            evidence: [
              { file: "src/App.tsx", line: 10, snippet: "class ErrorBoundary" },
            ],
            status: "confirmed",
            created_at: "2025-01-01",
            updated_at: "2025-01-01",
          },
        ]),
      },
    }
    ;(getContainer as ReturnType<typeof vi.fn>).mockReturnValue(mockContainer)
  })

  it("exports rules with correct compact format", async () => {
    const result = await queryCompactGraph({ orgId: "org-1", repoId: "repo-1" })

    expect(result.rules).toBeDefined()
    expect(result.rules.length).toBe(1)
    expect(result.rules[0]).toEqual(expect.objectContaining({
      key: "rule-1",
      name: "no-console",
      scope: "repo",
      severity: "warn",
      engine: "structural",
      query: "call_expression",
      file_glob: "**/*.ts",
      enabled: true,
    }))
  })

  it("exports patterns with correct compact format", async () => {
    const result = await queryCompactGraph({ orgId: "org-1", repoId: "repo-1" })

    expect(result.patterns).toBeDefined()
    expect(result.patterns.length).toBe(1)
    expect(result.patterns[0]).toEqual(expect.objectContaining({
      key: "pat-1",
      name: "error-boundary",
      kind: "structural",
      confidence: 0.88,
    }))
    expect(result.patterns[0]!.exemplar_keys).toHaveLength(1)
  })

  it("handles missing rules gracefully", async () => {
    const container = (getContainer as ReturnType<typeof vi.fn>)()
    container.graphStore.queryRules.mockRejectedValue(new Error("Not implemented"))

    const result = await queryCompactGraph({ orgId: "org-1", repoId: "repo-1" })
    expect(result.rules).toEqual([])
  })

  it("handles missing patterns gracefully", async () => {
    const container = (getContainer as ReturnType<typeof vi.fn>)()
    container.graphStore.queryPatterns.mockRejectedValue(new Error("Not implemented"))

    const result = await queryCompactGraph({ orgId: "org-1", repoId: "repo-1" })
    expect(result.patterns).toEqual([])
  })

  it("maps enforcement levels to severity", async () => {
    const container = (getContainer as ReturnType<typeof vi.fn>)()
    container.graphStore.queryRules.mockResolvedValue([
      { id: "r1", name: "block-rule", title: "Block", description: "", type: "security", scope: "repo", enforcement: "block", status: "active", priority: 1, semgrepRule: null, astGrepQuery: "q", repo_id: "r" },
      { id: "r2", name: "warn-rule", title: "Warn", description: "", type: "style", scope: "repo", enforcement: "warn", status: "active", priority: 1, semgrepRule: null, astGrepQuery: "q", repo_id: "r" },
      { id: "r3", name: "suggest-rule", title: "Suggest", description: "", type: "style", scope: "repo", enforcement: "suggest", status: "active", priority: 1, semgrepRule: null, astGrepQuery: "q", repo_id: "r" },
    ])

    const result = await queryCompactGraph({ orgId: "org-1", repoId: "repo-1" })
    expect(result.rules[0]!.severity).toBe("error")
    expect(result.rules[1]!.severity).toBe("warn")
    expect(result.rules[2]!.severity).toBe("info")
  })
})

describe("serializeToMsgpack v2", () => {
  it("passes rules and patterns to serializer", async () => {
    const rules = [{ key: "r1", name: "R1", scope: "repo", severity: "warn", engine: "structural", query: "q", message: "m", file_glob: "", enabled: true, repo_id: "r" }]
    const patterns = [{ key: "p1", name: "P1", kind: "structural", frequency: 5, confidence: 0.9, exemplar_keys: ["a:1"], promoted_rule_key: "" }]

    await serializeToMsgpack({
      repoId: "repo-1",
      orgId: "org-1",
      entities: [],
      edges: [],
      rules,
      patterns,
    })

    expect(serializeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        rules,
        patterns,
      })
    )
  })
})
