import { describe, expect, it } from "vitest"
import {
  buildFileCommitIndex,
  type CommitFileEntry,
  computeCoChangeEdges,
  computeTemporalContext,
  mapFileEdgesToEntityEdges,
  parseGitLogOutput,
} from "../git-analyzer"

// ── parseGitLogOutput ──────────────────────────────────────────────────────────

/** ASCII Record Separator — matches the record delimiter used in git-analyzer.ts */
const RS = "\x1e"
/** ASCII Unit Separator — matches the field delimiter used in git-analyzer.ts */
const F = "\x1f"

describe("parseGitLogOutput", () => {
  it("parses standard git log output", () => {
    const raw = [
      `${RS}abc123${F}feat: add login${F}dev@ex.com${F}1700000000`,
      "src/auth.ts",
      "src/login.ts",
      "",
      `${RS}def456${F}fix: typo${F}dev@ex.com${F}1700001000`,
      "README.md",
    ].join("\n")

    const result = parseGitLogOutput(raw)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      sha: "abc123",
      subject: "feat: add login",
      authorEmail: "dev@ex.com",
      timestamp: 1700000000,
      files: ["src/auth.ts", "src/login.ts"],
    })
    expect(result[1]!.files).toEqual(["README.md"])
  })

  it("handles pipe characters in commit subjects", () => {
    const raw = `${RS}abc123${F}fix: handle a | b case${F}dev@ex.com${F}1700000000\nsrc/parser.ts\n`
    const result = parseGitLogOutput(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.subject).toBe("fix: handle a | b case")
  })

  it("skips entries with no files", () => {
    const raw = `${RS}abc123${F}empty commit${F}dev@ex.com${F}1700000000\n\n`
    const result = parseGitLogOutput(raw)
    expect(result).toHaveLength(0)
  })

  it("handles malformed headers gracefully", () => {
    const raw = `${RS}badline\nfile.ts\n`
    const result = parseGitLogOutput(raw)
    expect(result).toHaveLength(0)
  })
})

// ── computeCoChangeEdges ───────────────────────────────────────────────────────

describe("computeCoChangeEdges", () => {
  const makeCommit = (sha: string, files: string[]): CommitFileEntry => ({
    sha,
    subject: "test",
    authorEmail: "dev@ex.com",
    timestamp: 1700000000,
    files,
  })

  it("detects co-changing files above threshold", () => {
    const commits = [
      makeCommit("c1", ["a.ts", "b.ts"]),
      makeCommit("c2", ["a.ts", "b.ts"]),
      makeCommit("c3", ["a.ts", "b.ts"]),
      makeCommit("c4", ["a.ts", "c.ts"]),
      makeCommit("c5", ["a.ts", "b.ts", "c.ts"]),
    ]

    const edges = computeCoChangeEdges(commits, 3, 0.3)
    expect(edges.length).toBeGreaterThanOrEqual(1)

    const abEdge = edges.find(
      (e) =>
        (e.fileA === "a.ts" && e.fileB === "b.ts") ||
        (e.fileA === "b.ts" && e.fileB === "a.ts"),
    )
    expect(abEdge).toBeDefined()
    expect(abEdge!.support).toBe(4) // c1, c2, c3, c5
  })

  it("filters out pairs below support threshold", () => {
    const commits = [
      makeCommit("c1", ["a.ts", "b.ts"]),
      makeCommit("c2", ["a.ts", "b.ts"]),
      // Only 2 co-occurrences, below threshold of 3
    ]

    const edges = computeCoChangeEdges(commits, 3, 0.3)
    expect(edges).toHaveLength(0)
  })

  it("returns empty for empty commits", () => {
    expect(computeCoChangeEdges([], 3, 0.3)).toHaveLength(0)
  })

  it("computes jaccard correctly", () => {
    // a.ts in c1,c2,c3; b.ts in c1,c2,c3 => support=3, union=3, jaccard=1.0
    const commits = [
      makeCommit("c1", ["a.ts", "b.ts"]),
      makeCommit("c2", ["a.ts", "b.ts"]),
      makeCommit("c3", ["a.ts", "b.ts"]),
    ]
    const edges = computeCoChangeEdges(commits, 3, 0.3)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.jaccard).toBe(1.0)
    expect(edges[0]!.confidence).toBe(1.0)
  })
})

// ── computeTemporalContext ─────────────────────────────────────────────────────

describe("computeTemporalContext", () => {
  const now = Math.floor(Date.now() / 1000)

  it("returns null for files with no commits", () => {
    expect(computeTemporalContext([], "nonexistent.ts")).toBeNull()
  })

  it("computes single-author concentration as 1.0", () => {
    const commits: CommitFileEntry[] = [
      { sha: "c1", subject: "fix: bug", authorEmail: "solo@ex.com", timestamp: now - 1000, files: ["app.ts"] },
      { sha: "c2", subject: "feat: add", authorEmail: "solo@ex.com", timestamp: now - 2000, files: ["app.ts"] },
      { sha: "c3", subject: "chore: clean", authorEmail: "solo@ex.com", timestamp: now - 3000, files: ["app.ts"] },
    ]
    const ctx = computeTemporalContext(commits, "app.ts")
    expect(ctx).not.toBeNull()
    expect(ctx!.author_count).toBe(1)
    expect(ctx!.author_concentration).toBe(1.0)
  })

  it("computes multi-author concentration < 1.0", () => {
    const commits: CommitFileEntry[] = [
      { sha: "c1", subject: "fix", authorEmail: "a@ex.com", timestamp: now - 1000, files: ["shared.ts"] },
      { sha: "c2", subject: "fix", authorEmail: "b@ex.com", timestamp: now - 2000, files: ["shared.ts"] },
    ]
    const ctx = computeTemporalContext(commits, "shared.ts")
    expect(ctx!.author_count).toBe(2)
    // Herfindahl: (0.5)^2 + (0.5)^2 = 0.5
    expect(ctx!.author_concentration).toBe(0.5)
  })

  it("classifies commit intents from subjects", () => {
    const commits: CommitFileEntry[] = [
      { sha: "c1", subject: "fix: login bug", authorEmail: "a@ex.com", timestamp: now - 1000, files: ["auth.ts"] },
      { sha: "c2", subject: "fix: validation", authorEmail: "a@ex.com", timestamp: now - 2000, files: ["auth.ts"] },
      { sha: "c3", subject: "feat: add oauth", authorEmail: "a@ex.com", timestamp: now - 3000, files: ["auth.ts"] },
    ]
    const ctx = computeTemporalContext(commits, "auth.ts")
    expect(ctx!.commit_intents).toContain("bugfix")
    expect(ctx!.commit_intents).toContain("feature")
    // bugfix should come first (2 occurrences vs 1)
    expect(ctx!.commit_intents[0]).toBe("bugfix")
  })

  it("computes stability: all-recent = 0 (volatile)", () => {
    const commits: CommitFileEntry[] = [
      { sha: "c1", subject: "fix", authorEmail: "a@ex.com", timestamp: now - 100, files: ["hot.ts"] },
      { sha: "c2", subject: "fix", authorEmail: "a@ex.com", timestamp: now - 200, files: ["hot.ts"] },
    ]
    const ctx = computeTemporalContext(commits, "hot.ts")
    // All commits are recent (within 90 days) → stability = 1 - 1.0 = 0
    expect(ctx!.stability_score).toBe(0)
  })

  it("computes stability: no-recent = 1 (stable)", () => {
    const longAgo = now - 200 * 24 * 60 * 60 // 200 days ago
    const commits: CommitFileEntry[] = [
      { sha: "c1", subject: "initial", authorEmail: "a@ex.com", timestamp: longAgo, files: ["stable.ts"] },
    ]
    const ctx = computeTemporalContext(commits, "stable.ts")
    expect(ctx!.stability_score).toBe(1)
    expect(ctx!.recent_change_frequency).toBe(0)
  })
})

// ── buildFileCommitIndex ──────────────────────────────────────────────────────

describe("buildFileCommitIndex", () => {
  const makeCommit = (sha: string, files: string[]): CommitFileEntry => ({
    sha,
    subject: "test",
    authorEmail: "dev@ex.com",
    timestamp: 1700000000,
    files,
  })

  it("returns empty map for empty commits", () => {
    const index = buildFileCommitIndex([])
    expect(index.size).toBe(0)
  })

  it("indexes single commit with multiple files", () => {
    const commit = makeCommit("c1", ["a.ts", "b.ts"])
    const index = buildFileCommitIndex([commit])
    expect(index.get("a.ts")).toEqual([commit])
    expect(index.get("b.ts")).toEqual([commit])
  })

  it("accumulates commits per file across multiple commits", () => {
    const c1 = makeCommit("c1", ["a.ts", "b.ts"])
    const c2 = makeCommit("c2", ["a.ts", "c.ts"])
    const c3 = makeCommit("c3", ["a.ts"])
    const index = buildFileCommitIndex([c1, c2, c3])
    expect(index.get("a.ts")).toHaveLength(3)
    expect(index.get("b.ts")).toHaveLength(1)
    expect(index.get("c.ts")).toHaveLength(1)
    expect(index.has("d.ts")).toBe(false)
  })

  it("computeTemporalContext uses pre-built index when provided", () => {
    const now = Math.floor(Date.now() / 1000)
    const commits: CommitFileEntry[] = [
      { sha: "c1", subject: "fix: bug", authorEmail: "a@ex.com", timestamp: now - 1000, files: ["app.ts", "other.ts"] },
      { sha: "c2", subject: "feat: add", authorEmail: "b@ex.com", timestamp: now - 2000, files: ["app.ts"] },
    ]
    const index = buildFileCommitIndex(commits)

    const ctx = computeTemporalContext(commits, "app.ts", index)
    expect(ctx).not.toBeNull()
    expect(ctx!.change_frequency).toBe(2)
    expect(ctx!.author_count).toBe(2)

    // File not in index returns null
    const missing = computeTemporalContext(commits, "missing.ts", index)
    expect(missing).toBeNull()
  })
})

// ── mapFileEdgesToEntityEdges ──────────────────────────────────────────────────

describe("mapFileEdgesToEntityEdges", () => {
  it("maps file edges to entity edges", () => {
    const coChangeEdges = [
      { fileA: "src/a.ts", fileB: "src/b.ts", support: 5, confidence: 0.8, jaccard: 0.6 },
    ]
    const entityFileMap = new Map([
      ["src/a.ts", ["entity-a1", "entity-a2"]],
      ["src/b.ts", ["entity-b1"]],
    ])

    const result = mapFileEdgesToEntityEdges(coChangeEdges, entityFileMap)
    expect(result).toHaveLength(2) // a1→b1, a2→b1
    expect(result[0]).toMatchObject({ fromId: "entity-a1", toId: "entity-b1", support: 5 })
    expect(result[1]).toMatchObject({ fromId: "entity-a2", toId: "entity-b1", support: 5 })
  })

  it("respects maxEdgesPerPair limit", () => {
    const coChangeEdges = [
      { fileA: "src/a.ts", fileB: "src/b.ts", support: 5, confidence: 0.8, jaccard: 0.6 },
    ]
    const entityFileMap = new Map([
      ["src/a.ts", ["e1", "e2", "e3"]],
      ["src/b.ts", ["e4", "e5", "e6"]],
    ])

    const result = mapFileEdgesToEntityEdges(coChangeEdges, entityFileMap, 2)
    expect(result).toHaveLength(2)
  })

  it("skips edges for files not in entity map", () => {
    const coChangeEdges = [
      { fileA: "src/a.ts", fileB: "src/missing.ts", support: 5, confidence: 0.8, jaccard: 0.6 },
    ]
    const entityFileMap = new Map([["src/a.ts", ["e1"]]])

    const result = mapFileEdgesToEntityEdges(coChangeEdges, entityFileMap)
    expect(result).toHaveLength(0)
  })
})
