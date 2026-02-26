import { beforeEach, describe, expect, it } from "vitest"
import { createTestContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"
import { analyzeDiff, isLineInChangedRange } from "@/lib/review/diff-analyzer"
import type { DiffFile } from "@/lib/review/diff-analyzer"

describe("isLineInChangedRange", () => {
  const files: DiffFile[] = [
    {
      filePath: "src/foo.ts",
      hunks: [
        { startLine: 10, lineCount: 5 }, // lines 10–14
        { startLine: 30, lineCount: 3 }, // lines 30–32
      ],
    },
    {
      filePath: "src/bar.ts",
      hunks: [{ startLine: 1, lineCount: 20 }], // lines 1–20
    },
  ]

  it("returns true for a line inside a hunk", () => {
    expect(isLineInChangedRange(files, "src/foo.ts", 10)).toBe(true)
    expect(isLineInChangedRange(files, "src/foo.ts", 14)).toBe(true)
    expect(isLineInChangedRange(files, "src/foo.ts", 30)).toBe(true)
    expect(isLineInChangedRange(files, "src/foo.ts", 32)).toBe(true)
  })

  it("returns false for a line outside all hunks", () => {
    // Line 15 is one past the end of the first hunk (startLine=10, lineCount=5 → [10,15))
    expect(isLineInChangedRange(files, "src/foo.ts", 15)).toBe(false)
    expect(isLineInChangedRange(files, "src/foo.ts", 25)).toBe(false)
    expect(isLineInChangedRange(files, "src/foo.ts", 33)).toBe(false)
  })

  it("returns false when filePath is not in the files list", () => {
    expect(isLineInChangedRange(files, "src/missing.ts", 10)).toBe(false)
  })

  it("correctly identifies lines in the second file", () => {
    // hunk: startLine=1, lineCount=20 → range [1, 21) → lines 1..20 inclusive
    expect(isLineInChangedRange(files, "src/bar.ts", 1)).toBe(true)
    expect(isLineInChangedRange(files, "src/bar.ts", 20)).toBe(true)
    expect(isLineInChangedRange(files, "src/bar.ts", 21)).toBe(false)
  })

  it("returns false when files array is empty", () => {
    expect(isLineInChangedRange([], "src/foo.ts", 5)).toBe(false)
  })
})

describe("analyzeDiff", () => {
  let container: Container

  beforeEach(() => {
    container = createTestContainer()
  })

  it("returns empty result for an empty diff string", async () => {
    const result = await analyzeDiff("", "org1", "repo1", container.graphStore)
    expect(result.files).toHaveLength(0)
    expect(result.strippedFiles).toHaveLength(0)
    expect(result.affectedEntities).toHaveLength(0)
  })

  it("parses changed files from a valid unified diff", async () => {
    const diff = [
      "diff --git a/src/utils.ts b/src/utils.ts",
      "--- a/src/utils.ts",
      "+++ b/src/utils.ts",
      "@@ -1,4 +1,5 @@",
      " export function helper() {",
      "+  // added line",
      "   return true",
      " }",
    ].join("\n")

    const result = await analyzeDiff(diff, "org1", "repo1", container.graphStore)

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.filePath).toBe("src/utils.ts")
    expect(result.files[0]?.hunks).toHaveLength(1)
    expect(result.strippedFiles).toHaveLength(0)
  })

  it("filters out package-lock.json from the diff", async () => {
    const diff = [
      "diff --git a/package-lock.json b/package-lock.json",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@ -1,3 +1,4 @@",
      " {",
      '+  "lockfileVersion": 3',
      " }",
    ].join("\n")

    const result = await analyzeDiff(diff, "org1", "repo1", container.graphStore)

    expect(result.files).toHaveLength(0)
    expect(result.strippedFiles).toContain("package-lock.json")
  })

  it("filters out yarn.lock from the diff", async () => {
    const diff = [
      "diff --git a/yarn.lock b/yarn.lock",
      "--- a/yarn.lock",
      "+++ b/yarn.lock",
      "@@ -10,3 +10,4 @@",
      " some-package:",
      "+  version: 1.2.3",
    ].join("\n")

    const result = await analyzeDiff(diff, "org1", "repo1", container.graphStore)

    expect(result.files).toHaveLength(0)
    expect(result.strippedFiles).toContain("yarn.lock")
  })

  it("filters out pnpm-lock.yaml from the diff", async () => {
    const diff = [
      "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
      "--- a/pnpm-lock.yaml",
      "+++ b/pnpm-lock.yaml",
      "@@ -5,3 +5,4 @@",
      " lockfileVersion: '6.0'",
    ].join("\n")

    const result = await analyzeDiff(diff, "org1", "repo1", container.graphStore)

    expect(result.files).toHaveLength(0)
    expect(result.strippedFiles).toContain("pnpm-lock.yaml")
  })

  it("keeps real source files while filtering lockfiles in a mixed diff", async () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,2 +1,3 @@",
      " const x = 1",
      "+const y = 2",
      "diff --git a/package-lock.json b/package-lock.json",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@ -1,2 +1,3 @@",
      " {}",
    ].join("\n")

    const result = await analyzeDiff(diff, "org1", "repo1", container.graphStore)

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.filePath).toBe("src/app.ts")
    expect(result.strippedFiles).toContain("package-lock.json")
  })

  it("maps changed lines to overlapping entities in the graph store", async () => {
    const orgId = "org-test"
    const repoId = "repo-test"

    // Upsert a function entity at lines 5–15
    await container.graphStore.upsertEntity(orgId, {
      id: "fn-helper",
      org_id: orgId,
      repo_id: repoId,
      kind: "function",
      name: "helperFn",
      file_path: "src/helpers.ts",
      start_line: 5,
      end_line: 15,
    })

    // Diff that touches lines 10–12 (overlaps with entity lines 5–15)
    const diff = [
      "diff --git a/src/helpers.ts b/src/helpers.ts",
      "--- a/src/helpers.ts",
      "+++ b/src/helpers.ts",
      "@@ -10,3 +10,4 @@",
      "   const a = 1",
      "+  const b = 2",
      "   return a",
      "   // end",
    ].join("\n")

    const result = await analyzeDiff(diff, orgId, repoId, container.graphStore)

    expect(result.affectedEntities).toHaveLength(1)
    expect(result.affectedEntities[0]?.id).toBe("fn-helper")
    expect(result.affectedEntities[0]?.changedLines).toHaveLength(1)
  })

  it("does not include entities whose line range does not overlap the diff hunks", async () => {
    const orgId = "org-test"
    const repoId = "repo-test"

    // Entity at lines 50–60, diff at lines 1–5 — no overlap
    await container.graphStore.upsertEntity(orgId, {
      id: "fn-remote",
      org_id: orgId,
      repo_id: repoId,
      kind: "function",
      name: "remoteFn",
      file_path: "src/helpers.ts",
      start_line: 50,
      end_line: 60,
    })

    const diff = [
      "diff --git a/src/helpers.ts b/src/helpers.ts",
      "--- a/src/helpers.ts",
      "+++ b/src/helpers.ts",
      "@@ -1,5 +1,6 @@",
      " const x = 1",
      "+const z = 3",
    ].join("\n")

    const result = await analyzeDiff(diff, orgId, repoId, container.graphStore)

    expect(result.affectedEntities).toHaveLength(0)
  })
})
